import { and, eq, inArray } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { decryptSecret, encryptSecret, isEncrypted } from '../crypto';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { allDefinitions } from '../modules/registry';
import { has } from '../permissions/service';
import { invalidateStorageConfigCache } from '../storage/config-cache';
import { invalidateMailTransportCache } from '../mail-cache';
import { CORE_SETTINGS, SECRET_BINDINGS, type SettingDefinition } from './catalog';

/** Höchstzahl Schlüssel je Speichervorgang (`setSettings`, `PUT /api/v1/settings`) */
export const MAX_SETTINGS_PER_WRITE = 100;
const CORE_WRITE_PERMISSION = 'core.settings.manage';

/** `<modul>.settings.manage`, wenn das Modul es deklariert (z. B. Kasse), sonst `core.settings.manage`. */
function moduleWritePermission(manifest: { id: string; permissions: string[] }): string {
	const own = `${manifest.id}.settings.manage`;
	return manifest.permissions.includes(own) ? own : CORE_WRITE_PERMISSION;
}

/** Recht, das zum Schreiben einer globalen Einstellung nötig ist. */
export function writePermissionOf(def: SettingDefinition): string {
	return def.writePermission ?? CORE_WRITE_PERMISSION;
}

/** Ziel-gebundene Secrets: Core (`SECRET_BINDINGS`) plus `secretBoundTo` aus Modul-Einstellungen */
function secretBindings(): { targets: string[]; secrets: string[] }[] {
	const out = [...SECRET_BINDINGS];
	for (const m of allDefinitions()) {
		for (const s of m.settings ?? []) {
			if (s.secret && s.secretBoundTo?.length) {
				out.push({ targets: s.secretBoundTo, secrets: [s.key] });
			}
		}
	}
	return out;
}

function definitionMap(): Map<string, SettingDefinition> {
	const map = new Map<string, SettingDefinition>();
	for (const d of CORE_SETTINGS) map.set(d.key, d);
	for (const m of allDefinitions()) {
		for (const s of m.settings ?? []) {
			map.set(s.key, {
				key: s.key,
				label: s.label,
				description: s.description,
				schema: s.schema,
				default: s.default,
				secret: s.secret,
				scope: 'global',
				group: m.manifest.id,
				writePermission: s.writePermission ?? moduleWritePermission(m.manifest)
			});
		}
	}
	return map;
}

export function getDefinition(key: string): SettingDefinition {
	const d = definitionMap().get(key);
	if (!d) throw errors.badRequest(`Unbekannte Einstellung: ${key}`);
	return d;
}

export function listDefinitions(): SettingDefinition[] {
	return [...definitionMap().values()];
}

function scopeIdFor(def: SettingDefinition, userId?: string | null): string {
	if (def.scope === 'global') return '';
	if (!userId) throw errors.badRequest('Benutzerspezifische Einstellung benötigt eine Benutzer-ID');
	return userId;
}

/** Serverseitiges Lesen. Secrets werden entschlüsselt – niemals an Clients weiterreichen. */
export async function getSetting<T = unknown>(key: string, userId?: string | null): Promise<T> {
	const def = getDefinition(key);
	const [row] = await getDb()
		.select()
		.from(schema.setting)
		.where(and(eq(schema.setting.key, key), eq(schema.setting.scopeId, scopeIdFor(def, userId))));
	if (!row) return def.default as T;
	if (def.secret && isEncrypted(row.value)) return decryptSecret(row.value) as T;
	return row.value as T;
}

export async function getSettings(
	keys: string[],
	userId?: string | null
): Promise<Record<string, unknown>> {
	const out: Record<string, unknown> = {};
	await Promise.all(keys.map(async (k) => (out[k] = await getSetting(k, userId))));
	return out;
}

export interface PublicSettingValue {
	key: string;
	label: string;
	description?: string;
	group: string;
	secret: boolean;
	scope: 'global' | 'user';
	/** Bei Secrets immer `null` */
	value: unknown;
	/** Bei Secrets: ob ein Wert gesetzt ist */
	isSet: boolean;
}

/**
 * `core.settings.listPublic` für Module (#67, 01a-12): wie `getPublicSettings`, aber nur mit
 * `core.settings.view` (bzw. System-Kontext) – auch nicht geheime Werte (z. B. Bankdaten) sind nicht für
 * jedes Modul bestimmt. Einzelwerte eigener Einstellungen liest ein Modul mit `core.settings.get`.
 */
export async function listPublicSettingsFor(
	ctx: RequestContext,
	filter: { group?: string; scope?: 'global' | 'user' } = {}
): Promise<PublicSettingValue[]> {
	if (ctx.actor.type !== 'system' && !ctx.userId) throw errors.unauthenticated();
	if (!has(ctx, 'core.settings.view')) {
		throw errors.forbidden('Berechtigung fehlt: core.settings.view');
	}
	return getPublicSettings({ ...filter, userId: ctx.userId });
}

/** Für UI/API: Secrets werden nie ausgeliefert. */
export async function getPublicSettings(
	filter: { group?: string; userId?: string | null; scope?: 'global' | 'user' } = {}
): Promise<PublicSettingValue[]> {
	const defs = listDefinitions().filter(
		(d) =>
			(!filter.group || d.group === filter.group) && (!filter.scope || d.scope === filter.scope)
	);
	if (!defs.length) return [];
	const rows = await getDb()
		.select()
		.from(schema.setting)
		.where(
			inArray(
				schema.setting.key,
				defs.map((d) => d.key)
			)
		);
	return defs.map((d) => {
		const sid = d.scope === 'global' ? '' : (filter.userId ?? '__none__');
		const row = rows.find((r) => r.key === d.key && r.scopeId === sid);
		const raw = row ? row.value : d.default;
		const isSet = d.secret ? typeof raw === 'string' && raw !== '' : raw !== undefined;
		return {
			key: d.key,
			label: d.label,
			description: d.description,
			group: d.group,
			secret: !!d.secret,
			scope: d.scope,
			value: d.secret ? null : raw,
			isSet
		};
	});
}

/**
 * `null` löscht den gespeicherten Wert (→ Standardwert). Erlaubt nur, wenn danach ein gültiger Wert gilt:
 * Secrets, Schemas mit `null` oder ein Standardwert, der das Schema erfüllt. Sonst 422 – `null` umgeht
 * so nie die Schemaprüfung.
 */
function isClearable(def: SettingDefinition): boolean {
	if (def.secret || def.schema.safeParse(null).success) return true;
	return def.default !== undefined && def.schema.safeParse(def.default).success;
}

type WriteOp =
	| { key: string; def: SettingDefinition; scopeId: string; kind: 'delete'; auto?: boolean }
	| { key: string; def: SettingDefinition; scopeId: string; kind: 'upsert'; value: unknown };

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface SetSettingsResult {
	/** Secrets, die wegen eines geänderten Ziels (Host, URL …) verworfen wurden */
	clearedSecrets: string[];
}

/**
 * Setzt mehrere Einstellungen **atomar**: erst werden alle Schlüssel geprüft (Existenz, Schreibrecht,
 * Schema; `null` nur, wenn löschbar), dann in EINER Transaktion geschrieben, danach Audit.
 *
 * - Globale Einstellungen brauchen ihr `writePermission` (Standard `core.settings.manage`, Modul-Schlüssel
 *   ggf. `<modul>.settings.manage`); benutzerspezifische dürfen nur für den eigenen Benutzer gesetzt werden.
 * - Secrets: `undefined`/leerer String behält den bisherigen Wert; `null` löscht.
 * - Ändert sich ein Ziel aus `SECRET_BINDINGS` oder einem Modul-`secretBoundTo` (z. B. SMTP-Host), wird das zugehörige Secret gelöscht,
 *   sofern es nicht im selben Aufruf neu gesetzt wird.
 * - Mehr als `MAX_SETTINGS_PER_WRITE` Schlüssel → 422.
 */
export async function setSettings(
	ctx: RequestContext,
	values: Record<string, unknown>,
	opts: { userId?: string } = {}
): Promise<SetSettingsResult> {
	const entries = Object.entries(values);
	if (entries.length > MAX_SETTINGS_PER_WRITE) {
		const message = `Höchstens ${MAX_SETTINGS_PER_WRITE} Einstellungen auf einmal`;
		throw errors.validation([{ path: ['values'], message }], message);
	}
	// 1) Existenz und Rechte – vor jeder Schemaprüfung
	const defs = entries.map(([key]) => getDefinition(key));
	const scopeIds = defs.map((def) => {
		if (def.scope === 'global') {
			const perm = writePermissionOf(def);
			if (!has(ctx, perm)) throw errors.forbidden(`Berechtigung fehlt: ${perm}`);
			return '';
		}
		if (!ctx.userId) throw errors.unauthenticated();
		const target = opts.userId ?? ctx.userId;
		if (target !== ctx.userId) throw errors.forbidden('Nur eigene Einstellungen änderbar');
		return target;
	});

	// 2) Werte prüfen (alle Fehler gesammelt, nichts geschrieben)
	const ops: WriteOp[] = [];
	const issues: { path: (string | number)[]; message: string }[] = [];
	entries.forEach(([key, value], i) => {
		const def = defs[i]!;
		const scopeId = scopeIds[i]!;
		if (def.secret && (value === undefined || value === '')) return;
		if (value === null) {
			if (!isClearable(def)) {
				issues.push({ path: [key], message: 'Diese Einstellung kann nicht gelöscht werden' });
				return;
			}
			ops.push({ key, def, scopeId, kind: 'delete' });
			return;
		}
		const parsed = def.schema.safeParse(value);
		if (!parsed.success) {
			for (const iss of parsed.error.issues) {
				const sub = iss.path.map((p) => (typeof p === 'number' ? p : String(p)));
				issues.push({ path: [key, ...sub], message: iss.message });
			}
			return;
		}
		ops.push({ key, def, scopeId, kind: 'upsert', value: parsed.data });
	});
	if (issues.length) {
		const message =
			issues.length === 1
				? `Ungültiger Wert für ${String(issues[0]!.path[0])}`
				: 'Ungültige Einstellungen';
		throw errors.validation(issues, message);
	}

	// 3) Ziel-gebundene Secrets verwerfen, wenn sich das Ziel ändert
	const clearedSecrets: string[] = [];
	const touched = new Map<string, WriteOp>(
		ops.filter((o) => o.scopeId === '').map((o) => [o.key, o])
	);
	const bindings = secretBindings();
	const targetKeys = bindings.flatMap((b) => b.targets).filter((k) => touched.has(k));
	if (targetKeys.length) {
		const rows = await getDb()
			.select()
			.from(schema.setting)
			.where(and(inArray(schema.setting.key, targetKeys), eq(schema.setting.scopeId, '')));
		const current = (k: string) => {
			const row = rows.find((r) => r.key === k);
			return row ? row.value : getDefinition(k).default;
		};
		for (const b of bindings) {
			const changed = b.targets.some((k) => {
				const op = touched.get(k);
				if (!op) return false;
				const next = op.kind === 'upsert' ? op.value : getDefinition(k).default;
				return !sameValue(current(k), next);
			});
			if (!changed) continue;
			for (const secret of b.secrets) {
				const op = touched.get(secret);
				if (op?.kind === 'upsert') continue; // im selben Vorgang neu gesetzt
				if (!op) {
					const auto: WriteOp = {
						key: secret,
						def: getDefinition(secret),
						scopeId: '',
						kind: 'delete',
						auto: true
					};
					ops.push(auto);
					touched.set(secret, auto);
				}
				clearedSecrets.push(secret);
			}
		}
	}

	// 4) Schreiben in einer Transaktion
	if (ops.length) {
		await getDb().transaction(async (tx) => {
			for (const op of ops) {
				const where = and(eq(schema.setting.key, op.key), eq(schema.setting.scopeId, op.scopeId));
				if (op.kind === 'delete') {
					await tx.delete(schema.setting).where(where);
					continue;
				}
				const stored = op.def.secret ? encryptSecret(String(op.value)) : op.value;
				await tx
					.insert(schema.setting)
					.values({ key: op.key, scopeId: op.scopeId, value: stored, updatedBy: ctx.userId })
					.onConflictDoUpdate({
						target: [schema.setting.key, schema.setting.scopeId],
						set: { value: stored, updatedAt: new Date(), updatedBy: ctx.userId }
					});
			}
		});
		// Storage-Konfiguration wird kurz zwischengespeichert (Team Performance, #23)
		if (ops.some((o) => o.key.startsWith('core.storage.'))) invalidateStorageConfigCache();
		// SMTP-Einstellungen und gepoolter Transport ebenso (#24)
		if (ops.some((o) => o.key.startsWith('core.smtp.'))) invalidateMailTransportCache();
	}

	// 5) Audit danach (nur globale Einstellungen; Secrets ohne Wert)
	for (const op of ops) {
		if (op.def.scope !== 'global') continue;
		let metadata: Record<string, unknown>;
		if (op.def.secret) {
			metadata = { secret: true };
			if (op.kind === 'delete') metadata.cleared = true;
			if (op.kind === 'delete' && op.auto) metadata.reason = 'target-changed';
		} else {
			metadata = { value: op.kind === 'upsert' ? op.value : null };
		}
		await auditFromContext(ctx, 'core.settings.changed', { target: op.key, metadata });
	}
	return { clearedSecrets: [...new Set(clearedSecrets)] };
}

/** Setzt eine Einstellung (wie `setSettings` mit genau einem Schlüssel). */
export async function setSetting(
	ctx: RequestContext,
	key: string,
	value: unknown,
	opts: { userId?: string } = {}
): Promise<void> {
	await setSettings(ctx, { [key]: value }, opts);
}
