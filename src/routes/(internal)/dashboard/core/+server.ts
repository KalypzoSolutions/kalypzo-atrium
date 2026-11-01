import { t } from '$lib/i18n';
import { json } from '@sveltejs/kit';
import { count, desc, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/core/database/client';
import { listModules } from '$lib/server/core/modules/service';
import type { CoreDashboardData } from '$lib/components/dashboard/core-data';
import type { RequestHandler } from './$types';

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Kennzahlen für die Core-Kacheln des Dashboards. Nur Felder, für die der angemeldete Benutzer
 * das Recht hat; alle anderen fehlen in der Antwort.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) {
		return json({ message: t('dashboard-feed.notSignedIn') }, { status: 401, headers: NO_STORE });
	}
	const perms = locals.ctx.permissions;
	const db = getDb();
	const data: CoreDashboardData = {};

	// Nacheinander statt parallel: PGlite (Tests/Demo) hat nur eine Sitzung
	if (perms.has('core.users.view')) {
		const [r] = await db
			.select({ n: count() })
			.from(schema.user)
			.where(eq(schema.user.active, true));
		data.users = Number(r?.n ?? 0);
	}
	if (perms.has('core.modules.view')) {
		data.modules = (await listModules()).filter((m) => m.enabled).length;
	}
	if (perms.has('core.api.view')) {
		const [r] = await db
			.select({ n: count() })
			.from(schema.apiKey)
			.where(isNull(schema.apiKey.revokedAt));
		data.apiKeys = Number(r?.n ?? 0);
	}
	if (perms.has('core.audit.view')) {
		const rows = await db
			.select({
				id: schema.auditLog.id,
				action: schema.auditLog.action,
				actorName: schema.auditLog.actorName,
				target: schema.auditLog.target,
				createdAt: schema.auditLog.createdAt
			})
			.from(schema.auditLog)
			.orderBy(desc(schema.auditLog.createdAt))
			.limit(8);
		data.recent = rows.map((r) => ({
			id: String(r.id),
			action: r.action,
			actorName: r.actorName ?? null,
			target: r.target ?? null,
			createdAt: new Date(String(r.createdAt)).toISOString()
		}));
	}
	return json({ data }, { headers: NO_STORE });
};
