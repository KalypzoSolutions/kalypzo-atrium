import { and, eq, inArray } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { decryptSecret, encryptSecret, isEncrypted } from '../crypto';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { allDefinitions } from '../modules/registry';
import { has } from '../permissions/service';
import { CORE_SETTINGS, type SettingDefinition } from './catalog';

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
				group: m.manifest.id
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
	if (!userId)
		throw errors.badRequest('Benutzerspezifische Einstellung benoetigt eine Benutzer-ID');
	return userId;
}

/** Serverseitiges Lesen. Secrets werden entschluesselt – niemals an Clients weiterreichen. */
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

/** Fuer UI/API: Secrets werden nie ausgeliefert. */
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
 * Setzt eine Einstellung. Globale Einstellungen erfordern `core.settings.manage`,
 * benutzerspezifische duerfen nur fuer den eigenen Benutzer gesetzt werden.
 * Secrets: `undefined`/leerer String behaelt den bisherigen Wert; `null` loescht.
 */
export async function setSetting(
	ctx: RequestContext,
	key: string,
	value: unknown,
	opts: { userId?: string } = {}
): Promise<void> {
	const def = getDefinition(key);
	let scopeId = '';
	if (def.scope === 'global') {
		if (!has(ctx, 'core.settings.manage')) {
			throw errors.forbidden('Berechtigung fehlt: core.settings.manage');
		}
	} else {
		if (!ctx.userId) throw errors.unauthenticated();
		const target = opts.userId ?? ctx.userId;
		if (target !== ctx.userId) throw errors.forbidden('Nur eigene Einstellungen aenderbar');
		scopeId = target;
	}
	if (def.secret && (value === undefined || value === '')) return;
	const db = getDb();
	if (value === null) {
		await db
			.delete(schema.setting)
			.where(and(eq(schema.setting.key, key), eq(schema.setting.scopeId, scopeId)));
	} else {
		const parsed = def.schema.safeParse(value);
		if (!parsed.success) {
			throw errors.validation(parsed.error.issues, `Ungueltiger Wert fuer ${key}`);
		}
		const stored = def.secret ? encryptSecret(String(parsed.data)) : parsed.data;
		await db
			.insert(schema.setting)
			.values({ key, scopeId, value: stored, updatedBy: ctx.userId })
			.onConflictDoUpdate({
				target: [schema.setting.key, schema.setting.scopeId],
				set: { value: stored, updatedAt: new Date(), updatedBy: ctx.userId }
			});
	}
	if (def.scope === 'global') {
		await auditFromContext(ctx, 'core.settings.changed', {
			target: key,
			metadata: def.secret ? { secret: true } : { value }
		});
	}
}
