/**
 * Kennzahlen zu einer Person für die Verwaltung (`core.users.view`): Anmeldungen, Aktivität, Sitzungen,
 * Schnittstelle, Dateien, KI. Nur Zähler und Zeitpunkte – keine Inhalte.
 */
import { eq, sql } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { t } from '$lib/i18n';
import { getDb, schema } from '../../database/client';
import { num, rowsOf, toIsoOrNull } from '../../database/rows';
import { errors } from '../../errors';
import { getUserPermissions, requirePermission } from '../../permissions/service';
import { roleIdsForUser } from '../../permissions/roles';
import { enabledModuleIds } from '../../modules/state';

/** Länge der Aktivitätskurve in Tagen */
export const ACTIVITY_DAYS = 90;

export interface UserStats {
	createdAt: string;
	lastLoginAt: string | null;
	/** Neueste Erneuerung einer gültigen Sitzung (grob: höchstens einmal am Tag aktualisiert) */
	lastSeenAt: string | null;
	passwordChangedAt: string | null;
	logins30: number;
	actions30: number;
	/** Audit-Einträge je Tag (älteste zuerst, `ACTIVITY_DAYS` Werte, UTC-Tage) */
	activity: { day: string; count: number }[];
	sessions: number;
	apiKeys: { active: number; lastUsedAt: string | null };
	apiCalls30: number;
	files: { count: number; bytes: number };
	ai30: { tokens: number; costUsd: number };
	roles: number;
	permissions: number;
	/** Wie oft die Verwaltung bisher „als diese Person“ gehandelt hat */
	impersonations: number;
}

function dayKey(d: Date): string {
	return d.toISOString().slice(0, 10);
}

export async function userStats(ctx: RequestContext, userId: string): Promise<UserStats> {
	await requirePermission(ctx, 'core.users.view');
	const db = getDb();
	const [u] = await db
		.select({
			createdAt: schema.user.createdAt,
			lastLoginAt: schema.user.lastLoginAt
		})
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!u) throw errors.notFound(t('auth.userNotFound'));

	// Nacheinander statt parallel: PGlite hat nur eine Sitzung
	const [audit] = await rowsOf(
		db,
		sql`SELECT
			count(*) FILTER (WHERE action = 'core.auth.login' AND created_at > now() - interval '30 days') AS logins,
			count(*) FILTER (WHERE created_at > now() - interval '30 days') AS actions
		FROM audit_log WHERE actor_id = ${userId}`
	);
	const daily = await rowsOf(
		db,
		sql`SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day, count(*) AS n
		FROM audit_log
		WHERE actor_id = ${userId} AND created_at > now() - make_interval(days => ${ACTIVITY_DAYS})
		GROUP BY 1`
	);
	const [sess] = await rowsOf(
		db,
		sql`SELECT count(*) AS n, max(updated_at) AS last FROM session WHERE user_id = ${userId} AND expires_at > now()`
	);
	const [pw] = await rowsOf(
		db,
		sql`SELECT max(updated_at) AS at FROM account WHERE user_id = ${userId} AND provider_id = 'credential'`
	);
	const [keys] = await rowsOf(
		db,
		sql`SELECT count(*) FILTER (WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS active,
			max(last_used_at) AS last
		FROM api_key WHERE owner_id = ${userId}`
	);
	const [calls] = await rowsOf(
		db,
		sql`SELECT count(*) AS n FROM api_log
		WHERE created_at > now() - interval '30 days'
			AND (actor_id = ${userId} OR api_key_id IN (SELECT id FROM api_key WHERE owner_id = ${userId}))`
	);
	const [files] = await rowsOf(
		db,
		sql`SELECT count(*) AS n, coalesce(sum(size), 0) AS bytes FROM file WHERE created_by = ${userId} AND status = 'ready'`
	);
	const [ai] = await rowsOf(
		db,
		sql`SELECT coalesce(sum(input_tokens + output_tokens), 0) AS tokens, coalesce(sum(cost_usd), 0) AS cost
		FROM ai_usage WHERE actor_id = ${userId} AND created_at > now() - interval '30 days'`
	);
	const [imp] = await rowsOf(
		db,
		sql`SELECT count(*) AS n FROM user_impersonation WHERE target_user_id = ${userId}`
	);
	const roleIds = await roleIdsForUser(userId);
	const perms = await getUserPermissions(userId);

	const byDay = new Map(daily.map((r) => [String(r.day), num(r.n)]));
	const activity: UserStats['activity'] = [];
	const today = new Date();
	for (let i = ACTIVITY_DAYS - 1; i >= 0; i--) {
		const d = new Date(
			Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i)
		);
		const day = dayKey(d);
		activity.push({ day, count: byDay.get(day) ?? 0 });
	}

	return {
		createdAt: u.createdAt.toISOString(),
		lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
		lastSeenAt: toIsoOrNull(sess?.last),
		passwordChangedAt: toIsoOrNull(pw?.at),
		logins30: num(audit?.logins),
		actions30: num(audit?.actions),
		activity,
		sessions: num(sess?.n),
		apiKeys: { active: num(keys?.active), lastUsedAt: toIsoOrNull(keys?.last) },
		apiCalls30: num(calls?.n),
		files: { count: num(files?.n), bytes: num(files?.bytes) },
		ai30: { tokens: num(ai?.tokens), costUsd: num(ai?.cost) },
		roles: roleIds.length,
		permissions: perms.size,
		impersonations: num(imp?.n)
	};
}

export interface PermissionOrigin {
	key: string;
	moduleId: string;
	/** Herkunft: Rolle (manuell), Rolle aus einem Modul (z. B. Ämter) oder Einzelrecht */
	sources: (
		| { kind: 'role'; roleId: string; roleName: string }
		| { kind: 'grant'; roleId: string; roleName: string; moduleId: string }
		| { kind: 'direct' }
	)[];
}

/** Wirksame Rechte einer Person mit Herkunft (nur wirksame: Modul aktiv, verleihendes Modul aktiv). */
export async function explainUserPermissions(
	ctx: RequestContext,
	userId: string
): Promise<PermissionOrigin[]> {
	await requirePermission(ctx, 'core.users.view');
	const db = getDb();
	const effective = await getUserPermissions(userId);
	const rows = await rowsOf(
		db,
		sql`SELECT rp.permission_key AS key, r.id AS role_id, r.name AS role_name, NULL::text AS grant_module, 'role' AS kind
			FROM user_role ur JOIN role r ON r.id = ur.role_id JOIN role_permission rp ON rp.role_id = r.id
			WHERE ur.user_id = ${userId}
		UNION ALL
		SELECT rp.permission_key, r.id, r.name, g.module_id, 'grant'
			FROM user_role_grant g JOIN role r ON r.id = g.role_id JOIN role_permission rp ON rp.role_id = r.id
			WHERE g.user_id = ${userId}
		UNION ALL
		SELECT up.permission_key, NULL, NULL, NULL, 'direct'
			FROM user_permission up WHERE up.user_id = ${userId}`
	);
	const modules = await rowsOf(db, sql`SELECT key, module_id FROM permission`);
	const enabled = await enabledModuleIds();
	const moduleOf = new Map(modules.map((m) => [String(m.key), String(m.module_id)]));
	const map = new Map<string, PermissionOrigin>();
	for (const r of rows) {
		const key = String(r.key);
		if (!effective.has(key)) continue;
		const entry = map.get(key) ?? { key, moduleId: moduleOf.get(key) ?? 'core', sources: [] };
		if (r.kind === 'direct') entry.sources.push({ kind: 'direct' });
		else if (r.kind === 'grant') {
			// Verleihendes Modul deaktiviert → diese Herkunft wirkt nicht
			if (!enabled.has(String(r.grant_module))) continue;
			entry.sources.push({
				kind: 'grant',
				roleId: String(r.role_id),
				roleName: String(r.role_name),
				moduleId: String(r.grant_module)
			});
		} else {
			entry.sources.push({
				kind: 'role',
				roleId: String(r.role_id),
				roleName: String(r.role_name)
			});
		}
		map.set(key, entry);
	}
	return [...map.values()].sort(
		(a, b) => a.moduleId.localeCompare(b.moduleId) || a.key.localeCompare(b.key)
	);
}
