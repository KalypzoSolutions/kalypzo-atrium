/**
 * Kennzahlen für die Verwaltungsübersicht (`/admin`): je Kachel nur mit passendem Recht, nur Zähler.
 * Kurz zwischengespeichert (30 s je Rechte-Kombination), damit die Übersicht schnell bleibt.
 */
import { sql } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { getDb } from '../database/client';
import { num, rowsOf } from '../database/rows';
import { ADMIN_ROLE_ID } from '../permissions/catalog';

export interface AdminOverviewStats {
	users?: {
		active: number;
		total: number;
		/** Anmeldungen je Tag (30 Tage, älteste zuerst) */
		logins: { day: string; count: number }[];
		logins30: number;
		failed24h: number;
		sessions: number;
		/** Aktive Konten mit Rolle Administrator ohne 2FA */
		adminsWithout2fa: number;
		/** Aktive Konten, die sich nie angemeldet haben (z. B. offene Einladungen) */
		neverSignedIn: number;
		mustChange: number;
		impersonating: number;
	};
	api?: { calls24h: number; errors24h: number };
	storage?: { bytes: number; files: number };
	ai?: { costMonthUsd: number; tokensMonth: number };
	jobs?: { failed: number };
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: AdminOverviewStats }>();

export function invalidateAdminOverviewCache(): void {
	cache.clear();
}

export async function adminOverviewStats(ctx: RequestContext): Promise<AdminOverviewStats> {
	const has = (k: string) => ctx.actor.type === 'system' || ctx.permissions.has(k);
	const flags = {
		users: has('core.users.view'),
		api: has('core.api.view'),
		storage: has('core.storage.manage'),
		ai: has('core.ai.manage') || has('core.ai.view'),
		jobs: has('core.jobs.manage')
	};
	const key = JSON.stringify(flags);
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

	const db = getDb();
	const out: AdminOverviewStats = {};
	// Nacheinander: PGlite hat nur eine Sitzung
	if (flags.users) {
		const [u] = await rowsOf(
			db,
			sql`SELECT
				count(*) FILTER (WHERE active) AS active,
				count(*) AS total,
				count(*) FILTER (WHERE active AND last_login_at IS NULL) AS never,
				count(*) FILTER (WHERE active AND must_change_password) AS must_change,
				count(*) FILTER (WHERE active AND NOT two_factor_enabled
					AND id IN (SELECT user_id FROM user_role WHERE role_id = ${ADMIN_ROLE_ID})) AS admins_no_2fa
			FROM "user"`
		);
		const [a] = await rowsOf(
			db,
			sql`SELECT
				count(*) FILTER (WHERE action = 'core.auth.login' AND created_at > now() - interval '30 days') AS logins,
				count(*) FILTER (WHERE action = 'core.auth.login_failed' AND created_at > now() - interval '24 hours') AS failed
			FROM audit_log
			WHERE action IN ('core.auth.login', 'core.auth.login_failed') AND created_at > now() - interval '30 days'`
		);
		const daily = await rowsOf(
			db,
			sql`SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*) AS n
			FROM audit_log WHERE action = 'core.auth.login' AND created_at > now() - interval '30 days'
			GROUP BY 1`
		);
		const [s] = await rowsOf(db, sql`SELECT count(*) AS n FROM session WHERE expires_at > now()`);
		const [imp] = await rowsOf(
			db,
			sql`SELECT count(*) AS n FROM user_impersonation WHERE ended_at IS NULL AND expires_at > now()`
		);
		const byDay = new Map(daily.map((r) => [String(r.day), num(r.n)]));
		const logins: { day: string; count: number }[] = [];
		const now = new Date();
		for (let i = 29; i >= 0; i--) {
			const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
			const day = d.toISOString().slice(0, 10);
			logins.push({ day, count: byDay.get(day) ?? 0 });
		}
		out.users = {
			active: num(u?.active),
			total: num(u?.total),
			logins,
			logins30: num(a?.logins),
			failed24h: num(a?.failed),
			sessions: num(s?.n),
			adminsWithout2fa: num(u?.admins_no_2fa),
			neverSignedIn: num(u?.never),
			mustChange: num(u?.must_change),
			impersonating: num(imp?.n)
		};
	}
	if (flags.api) {
		const [r] = await rowsOf(
			db,
			sql`SELECT count(*) AS n, count(*) FILTER (WHERE status >= 500) AS err
			FROM api_log WHERE created_at > now() - interval '24 hours'`
		);
		out.api = { calls24h: num(r?.n), errors24h: num(r?.err) };
	}
	if (flags.storage) {
		const [r] = await rowsOf(
			db,
			sql`SELECT count(*) AS n, coalesce(sum(size), 0) AS bytes FROM file WHERE status = 'ready'`
		);
		out.storage = { files: num(r?.n), bytes: num(r?.bytes) };
	}
	if (flags.ai) {
		const [r] = await rowsOf(
			db,
			sql`SELECT coalesce(sum(cost_usd), 0) AS cost, coalesce(sum(input_tokens + output_tokens), 0) AS tokens
			FROM ai_usage WHERE created_at >= date_trunc('month', now())`
		);
		out.ai = { costMonthUsd: num(r?.cost), tokensMonth: num(r?.tokens) };
	}
	if (flags.jobs) {
		const [r] = await rowsOf(
			db,
			sql`SELECT count(*) AS n FROM job_run WHERE last_status = 'error'`
		);
		out.jobs = { failed: num(r?.n) };
	}
	cache.set(key, { at: Date.now(), value: out });
	return out;
}
