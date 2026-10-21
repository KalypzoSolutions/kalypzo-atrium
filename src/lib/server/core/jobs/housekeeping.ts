/**
 * Core-Job `core.housekeeping` (täglich): setzt die Aufbewahrungsfristen der Protokolle durch.
 * - `api_log`: Einträge älter als `core.retention.apiLogDays` löschen.
 * - `audit_log`: IP-Adressen nach `core.retention.auditIpDays` auf NULL setzen, Einträge nach
 *   `core.retention.auditDays` löschen (0 = nie). Der Audit-Trigger erlaubt das nur in einer
 *   Transaktion mit `SET LOCAL app.audit_retention = 'on'` (Migration 0007).
 * Alles in Stapeln mit je eigener kurzer Transaktion (keine langen Sperren, PGlite-tauglich).
 */
import { sql, type SQL } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, type DbOrTx } from '../database/client';
import { getSetting } from '../settings/service';

const DAY_MS = 24 * 60 * 60_000;
/** Zeilen je Stapel */
export const HOUSEKEEPING_BATCH = 5000;

export const RETENTION_DEFAULTS = {
	apiLogDays: 30,
	auditIpDays: 90,
	auditDays: 730
} as const;

export interface HousekeepingResult {
	apiLogDeleted: number;
	auditIpCleared: number;
	auditDeleted: number;
}

async function days(key: keyof typeof RETENTION_DEFAULTS): Promise<number> {
	const fallback = RETENTION_DEFAULTS[key];
	try {
		const v = Number(await getSetting(`core.retention.${key}`));
		return Number.isInteger(v) && v >= 0 ? v : fallback;
	} catch {
		return fallback;
	}
}

async function count(db: DbOrTx, query: SQL): Promise<number> {
	const res = (await db.execute(query)) as unknown as { rows: { n: unknown }[] };
	return Number(res.rows[0]?.n ?? 0);
}

/** Wiederholt `step` (eine Transaktion je Stapel), bis ein Stapel kleiner als die Stapelgröße ist. */
async function inBatches(step: () => Promise<number>): Promise<number> {
	let total = 0;
	for (;;) {
		const n = await step();
		total += n;
		if (n < HOUSEKEEPING_BATCH) return total;
	}
}

const before = (now: Date, d: number) => new Date(now.getTime() - d * DAY_MS).toISOString();

/** Führt die Bereinigung aus und schreibt bei Änderungen einen Audit-Eintrag (nur Zähler). */
export async function runHousekeeping(
	ctx: RequestContext,
	now: Date = new Date()
): Promise<HousekeepingResult> {
	const db = getDb();
	const apiLogDays = await days('apiLogDays');
	const auditIpDays = await days('auditIpDays');
	const auditDays = await days('auditDays');

	const apiCutoff = before(now, Math.max(1, apiLogDays));
	const apiLogDeleted = await inBatches(() =>
		count(
			db,
			sql`WITH d AS (
				DELETE FROM api_log WHERE id IN (
					SELECT id FROM api_log WHERE created_at < ${apiCutoff} LIMIT ${HOUSEKEEPING_BATCH}
				) RETURNING 1
			) SELECT count(*)::int AS n FROM d`
		)
	);

	const retention = <T>(fn: (tx: DbOrTx) => Promise<T>) =>
		db.transaction(async (tx) => {
			await tx.execute(sql.raw(`SET LOCAL app.audit_retention = 'on'`));
			return fn(tx);
		});

	let auditDeleted = 0;
	if (auditDays > 0) {
		const cutoff = before(now, auditDays);
		auditDeleted = await inBatches(() =>
			retention((tx) =>
				count(
					tx,
					sql`WITH d AS (
						DELETE FROM audit_log WHERE id IN (
							SELECT id FROM audit_log WHERE created_at < ${cutoff} LIMIT ${HOUSEKEEPING_BATCH}
						) RETURNING 1
					) SELECT count(*)::int AS n FROM d`
				)
			)
		);
	}

	const ipCutoff = before(now, Math.max(1, auditIpDays));
	const auditIpCleared = await inBatches(() =>
		retention((tx) =>
			count(
				tx,
				sql`WITH u AS (
					UPDATE audit_log SET ip = NULL WHERE id IN (
						SELECT id FROM audit_log
						WHERE ip IS NOT NULL AND created_at < ${ipCutoff} LIMIT ${HOUSEKEEPING_BATCH}
					) RETURNING 1
				) SELECT count(*)::int AS n FROM u`
			)
		)
	);

	const result = { apiLogDeleted, auditIpCleared, auditDeleted };
	if (apiLogDeleted || auditIpCleared || auditDeleted) {
		await auditFromContext(ctx, 'core.system.housekeeping', {
			metadata: { ...result, apiLogDays, auditIpDays, auditDays }
		});
	}
	return result;
}
