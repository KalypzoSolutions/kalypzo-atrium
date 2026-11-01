import { and, desc, eq, gte, ilike, inArray, like, lte, or, sql } from 'drizzle-orm';
import type { Actor, RequestContext } from '$lib/sdk/types';
import { getDb, schema, type DbOrTx } from '../database/client';
import { errors } from '../errors';
import { newId } from '../util';
import { t } from '$lib/i18n';

const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|hash/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/**
 * Personenbezogene Schlüssel (Blockliste, #26): Das Audit ist unveränderlich, solche Werte ließen sich
 * nie mehr löschen. Zahlen/Wahrheitswerte (Zähler wie `emails: 2`, `ibanChanged: true`) bleiben,
 * Texte werden entfernt bzw. E-Mail-Adressen maskiert – jeweils mit Warnung im Server-Log, damit der
 * Aufrufer korrigiert wird. Objektnamen (`name` einer Aktion, eines Amts) sind bewusst erlaubt.
 */
const PERSONAL_KEY =
	/^(e-?mail|emails?(from|to)?|birth[-_]?date|geburtsdatum|iban|phone|telefon|street|strasse|address|adresse|first[-_]?name|last[-_]?name|vorname|nachname|allergien|medikamente|gesundheit)$/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskAuditEmail(v: string): string {
	const at = v.lastIndexOf('@');
	return at < 1 ? '***' : `${v[0]}***${v.slice(at)}`;
}

function warnPersonal(key: string, where: string | undefined): void {
	console.warn(
		`[audit] Personenbezogenes Feld „${key}“ in den Metadaten${where ? ` von ${where}` : ''} bereinigt`
	);
}

/** Entfernt Geheimnisse und personenbezogene Werte und begrenzt die Größe von Audit-Metadaten. */
export function sanitizeMetadata(value: unknown, depth = 0, where?: string): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string') {
		// Unmaskierte E-Mail-Adresse unter beliebigem Schlüssel → maskieren
		if (EMAIL_VALUE.test(value) && !value.includes('***@')) {
			warnPersonal('E-Mail-Adresse', where);
			return maskAuditEmail(value);
		}
		return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (value instanceof Date) return value.toISOString();
	if (depth >= MAX_DEPTH) return '[truncated]';
	if (Array.isArray(value)) {
		return value.slice(0, 50).map((v) => sanitizeMetadata(v, depth + 1, where));
	}
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (SENSITIVE_KEY.test(k)) out[k] = '[redacted]';
			else if (
				PERSONAL_KEY.test(k) &&
				v !== null &&
				v !== undefined &&
				typeof v !== 'number' &&
				typeof v !== 'boolean'
			) {
				// Bereits maskierte Adressen (`a***@…`) sind erlaubt
				if (typeof v === 'string' && /^.\*\*\*@/.test(v)) out[k] = v;
				else {
					warnPersonal(k, where);
					out[k] = typeof v === 'string' && EMAIL_VALUE.test(v) ? maskAuditEmail(v) : '[entfernt]';
				}
			} else out[k] = sanitizeMetadata(v, depth + 1, where);
		}
		return out;
	}
	return String(value);
}

export interface AuditEntry {
	/** `modul.ressource.aktion`, z. B. `core.user.created` */
	action: string;
	actor: Actor;
	target?: string;
	metadata?: Record<string, unknown>;
	ip?: string | null;
	requestId?: string | null;
}

export async function logAudit(entry: AuditEntry, tx?: DbOrTx): Promise<void> {
	const db = tx ?? getDb();
	await db.insert(schema.auditLog).values({
		id: newId(),
		action: entry.action,
		actorType: entry.actor.type,
		actorId: entry.actor.id,
		actorName: entry.actor.name,
		target: entry.target ?? null,
		ip: entry.ip ?? null,
		requestId: entry.requestId ?? null,
		metadata: (sanitizeMetadata(entry.metadata ?? {}, 0, entry.action) ?? {}) as Record<
			string,
			unknown
		>
	});
}

/** Komfortvariante: Akteur, IP und Request-ID aus dem Kontext übernehmen. */
export function auditFromContext(
	ctx: RequestContext,
	action: string,
	extra: { target?: string; metadata?: Record<string, unknown> } = {},
	tx?: DbOrTx
): Promise<void> {
	return logAudit({ action, actor: ctx.actor, ip: ctx.ip, requestId: ctx.requestId, ...extra }, tx);
}

export interface AuditFilter {
	search?: string;
	action?: string;
	actorId?: string;
	/** Exakter Treffer auf `target` (Entitäts-ID) */
	target?: string;
	/** Exakte Treffer auf mehrere `target`-IDs (max. 50) */
	targets?: string[];
	from?: Date;
	to?: Date;
	limit?: number;
	offset?: number;
}

export async function listAudit(filter: AuditFilter = {}) {
	const db = getDb();
	const t = schema.auditLog;
	const conds = [];
	if (filter.action) {
		// Aktionen sind ASCII-klein: `LIKE 'prefix%'` nutzt den Index `audit_log_action_pattern_idx`
		const prefix = filter.action.toLowerCase().replace(/[\\%_]/g, '\\$&');
		conds.push(like(t.action, `${prefix}%`));
	}
	if (filter.actorId) conds.push(eq(t.actorId, filter.actorId));
	if (filter.target) conds.push(eq(t.target, filter.target));
	if (filter.targets) {
		// leere Liste → nichts finden (statt alles)
		conds.push(filter.targets.length ? inArray(t.target, filter.targets.slice(0, 50)) : sql`false`);
	}
	if (filter.from) conds.push(gte(t.createdAt, filter.from));
	if (filter.to) conds.push(lte(t.createdAt, filter.to));
	if (filter.search) {
		const s = `%${filter.search.replace(/[%_\\]/g, '')}%`;
		conds.push(or(ilike(t.action, s), ilike(t.actorName, s), ilike(t.target, s)));
	}
	const where = conds.length ? and(...conds) : undefined;
	const limit = Math.min(filter.limit ?? 50, 200);
	const [rows, [count]] = await Promise.all([
		db
			.select()
			.from(t)
			.where(where)
			.orderBy(desc(t.createdAt))
			.limit(limit)
			.offset(filter.offset ?? 0),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(t)
			.where(where)
	]);
	return { rows, total: count?.n ?? 0 };
}

const MODULE_ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Audit-Einträge **eines Moduls** zu bekannten Objekten (#67, 01a-12) – die Variante für Module statt
 * `listAudit`: nur Aktionen `<moduleId>.…`, nur die angegebenen `targets` (≥ 1, höchstens 50) und nur für
 * Aufrufer*innen mit mindestens einem Recht dieses Moduls (sonst 401/403). Fachliche Rechte prüft der Endpunkt.
 */
export async function listModuleAudit(
	ctx: RequestContext,
	moduleId: string,
	filter: { targets: string[]; limit?: number; offset?: number }
) {
	if (!MODULE_ID_RE.test(moduleId)) throw errors.badRequest(t('audit.invalidModuleId'));
	if (ctx.actor.type !== 'system') {
		if (!ctx.userId) throw errors.unauthenticated();
		const prefix = `${moduleId}.`;
		if (![...ctx.permissions].some((p) => p.startsWith(prefix))) {
			throw errors.forbidden(t('audit.permissionMissing', { permission: `${moduleId}.*` }));
		}
	}
	return listAudit({
		action: `${moduleId}.`,
		targets: filter.targets,
		limit: filter.limit,
		offset: filter.offset
	});
}

/**
 * Übergangsvariante für `core.audit.list` (Module): verlangt `targets`, damit kein Modul das gesamte
 * Audit-Log lesen kann. Neue Aufrufe nutzen `listModuleAudit` (mit Kontext und Modulpräfix).
 * @deprecated `core.audit.listForModule(ctx, moduleId, { targets })` verwenden.
 */
export async function listAuditByTargets(filter: AuditFilter & { targets: string[] }) {
	if (!Array.isArray(filter.targets)) throw errors.badRequest(t('audit.targetsMissing'));
	return listAudit({ ...filter, targets: filter.targets });
}
