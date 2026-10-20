import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import type { Actor, RequestContext } from '$lib/sdk/types';
import { getDb, schema, type DbOrTx } from '../database/client';
import { newId } from '../util';

const SENSITIVE_KEY = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential|hash/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/** Entfernt Geheimnisse und begrenzt die Größe von Audit-Metadaten. */
export function sanitizeMetadata(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string') {
		return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + '…' : value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') return value;
	if (value instanceof Date) return value.toISOString();
	if (depth >= MAX_DEPTH) return '[truncated]';
	if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeMetadata(v, depth + 1));
	if (typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : sanitizeMetadata(v, depth + 1);
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
		metadata: (sanitizeMetadata(entry.metadata ?? {}) ?? {}) as Record<string, unknown>
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
	if (filter.action) conds.push(ilike(t.action, `${filter.action.replace(/[%_]/g, '')}%`));
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
