import type { Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { disableModule, enableModule, listModules } from '$lib/server/core/modules/service';
import { invalid, requirePerm, toFail } from '../settings/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.modules.view');
	const modules = await listModules();
	return {
		modules: modules.map((m) => ({
			id: m.manifest.id,
			name: m.manifest.name,
			description: m.manifest.description ?? '',
			version: m.manifest.version,
			installedVersion: m.installedVersion,
			enabled: m.enabled,
			dependencies: m.manifest.dependencies,
			dependents: m.dependents,
			missingDependencies: m.missingDependencies,
			permissionCount: m.manifest.permissions.length
		})),
		canManage: locals.ctx.permissions.has('core.modules.manage')
	};
};

const idSchema = z.object({ id: z.string().min(1).max(40) });

export const actions: Actions = {
	enable: async ({ request, locals }) => {
		const parsed = idSchema.safeParse({ id: (await request.formData()).get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await enableModule(locals.ctx, parsed.data.id);
			return { success: true, message: 'Modul aktiviert' };
		} catch (e) {
			return toFail(e);
		}
	},
	disable: async ({ request, locals }) => {
		const parsed = idSchema.safeParse({ id: (await request.formData()).get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await disableModule(locals.ctx, parsed.data.id);
			return { success: true, message: 'Modul deaktiviert' };
		} catch (e) {
			return toFail(e);
		}
	}
};
