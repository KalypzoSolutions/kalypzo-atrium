import { count, desc, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '$lib/server/core/database/client';
import { listModules } from '$lib/server/core/modules/service';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const perms = locals.ctx.permissions;
	const db = getDb();

	const stats: { key: string; label: string; value: number; href?: string }[] = [];
	if (perms.has('core.users.view')) {
		const [r] = await db
			.select({ n: count() })
			.from(schema.user)
			.where(eq(schema.user.active, true));
		stats.push({ key: 'users', label: 'Aktive Benutzer', value: r?.n ?? 0, href: '/users' });
	}
	if (perms.has('core.modules.view')) {
		const mods = await listModules();
		stats.push({
			key: 'modules',
			label: 'Aktive Module',
			value: mods.filter((m) => m.enabled).length,
			href: '/modules'
		});
	}
	if (perms.has('core.api.view')) {
		const [r] = await db
			.select({ n: count() })
			.from(schema.apiKey)
			.where(isNull(schema.apiKey.revokedAt));
		stats.push({ key: 'keys', label: 'Aktive API-Keys', value: r?.n ?? 0, href: '/api-keys' });
	}

	const recent = perms.has('core.audit.view')
		? await db
				.select({
					id: schema.auditLog.id,
					action: schema.auditLog.action,
					actorName: schema.auditLog.actorName,
					target: schema.auditLog.target,
					createdAt: schema.auditLog.createdAt
				})
				.from(schema.auditLog)
				.orderBy(desc(schema.auditLog.createdAt))
				.limit(8)
		: null;

	return { stats, recent };
};
