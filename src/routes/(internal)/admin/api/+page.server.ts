import type { Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '$lib/i18n';
import { createApiKey, listApiKeys, revokeApiKey } from '$lib/server/core/api/keys';
import { listPermissions } from '$lib/server/core/permissions/service';
import { invalid, requirePerm, toFail } from '../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.api.view');
	const [keys, permissions] = await Promise.all([listApiKeys(locals.ctx), listPermissions()]);
	return {
		keys: keys.map((k) => ({
			id: k.id,
			name: k.name,
			prefix: k.prefix,
			scopes: k.scopes,
			expiresAt: k.expiresAt,
			revokedAt: k.revokedAt,
			lastUsedAt: k.lastUsedAt,
			createdAt: k.createdAt
		})),
		// Nur Scopes, die der Benutzer selbst besitzt, können vergeben werden
		scopes: permissions
			.filter((p) => locals.ctx.permissions.has(p.key))
			.map((p) => ({ key: p.key, moduleId: p.moduleId, description: p.description })),
		canManage: locals.ctx.permissions.has('core.api.manage')
	};
};

// Je Aufruf gebaut, damit die Fehlertexte in der Sprache des Requests erscheinen
const createSchema = () =>
	z.object({
		name: z.string().trim().min(2, t('admin-api.server.nameMin')).max(80),
		scopes: z.array(z.string()).min(1, t('admin-api.server.scopeRequired')).max(200),
		expiresAt: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, t('admin-api.server.invalidDate'))
			.optional()
	});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const fd = await request.formData();
		const exp = String(fd.get('expiresAt') ?? '').trim();
		const parsed = createSchema().safeParse({
			name: fd.get('name'),
			scopes: fd.getAll('scopes').map(String),
			expiresAt: exp || undefined
		});
		if (!parsed.success) return invalid(parsed.error);
		try {
			const { key, item } = await createApiKey(locals.ctx, {
				name: parsed.data.name,
				scopes: parsed.data.scopes,
				expiresAt: parsed.data.expiresAt ? new Date(`${parsed.data.expiresAt}T23:59:59`) : null
			});
			// Der Klartext-Key wird nur in dieser Antwort ausgeliefert.
			return { success: true, message: t('admin-api.server.created'), key, name: item.name };
		} catch (e) {
			return toFail(e);
		}
	},
	revoke: async ({ request, locals }) => {
		const id = z
			.string()
			.min(1)
			.safeParse((await request.formData()).get('id'));
		if (!id.success) return invalid(id.error);
		try {
			await revokeApiKey(locals.ctx, id.data);
			return { success: true, message: t('admin-api.server.revoked') };
		} catch (e) {
			return toFail(e);
		}
	}
};
