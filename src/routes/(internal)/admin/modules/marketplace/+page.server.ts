import { type Actions, fail } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import {
	getMarketplace,
	installLinkFor,
	refreshMarketplace
} from '$lib/server/core/modules/install/marketplace';
import { listInstalledSources } from '$lib/server/core/modules/install/service';
import { listModules } from '$lib/server/core/modules/service';
import { isAdministrator } from '$lib/server/core/permissions/service';
import { setSettings } from '$lib/server/core/settings/service';
import { failWithFields, requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.modules.view');
	const [marketplace, modules, origins] = await Promise.all([
		getMarketplace({ waitMs: 2500 }),
		listModules(),
		listInstalledSources(locals.ctx)
	]);
	return {
		marketplace,
		sources: (marketplace.index?.sources ?? []).map((source) => ({
			...source,
			installLink: installLinkFor(source.source),
			modules: source.modules.map((m) => ({
				...m,
				installLink: installLinkFor(source.source, m.id)
			}))
		})),
		installed: modules.map((m) => ({
			id: m.manifest.id,
			version: m.installedVersion ?? m.manifest.version,
			enabled: m.enabled,
			origin: origins.find((s) => s.id === m.manifest.id)?.sourceType ?? 'build'
		})),
		canInstall: locals.ctx.permissions.has('core.modules.install') && isAdministrator(locals.ctx),
		canRefresh:
			locals.ctx.permissions.has('core.modules.install') ||
			locals.ctx.permissions.has('core.modules.manage')
	};
};
export const actions: Actions = {
	refresh: async ({ locals }) => {
		if (!locals.ctx.permissions.has('core.modules.install'))
			requirePerm(locals, 'core.modules.manage');
		else requirePerm(locals, 'core.modules.install');
		await refreshMarketplace();
		return { refreshed: true };
	},
	saveUrl: async ({ request, locals }) => {
		requirePerm(locals, 'core.modules.install');
		const url = String((await request.formData()).get('url') ?? '').trim();
		try {
			await setSettings(locals.ctx, { 'core.modules.marketplaceUrl': url });
			return { saved: true };
		} catch (e) {
			const result = failWithFields(e);
			const fields = result.data.fields;
			return fail(result.status, {
				message: result.data.message ?? t('admin-marketplace.invalidUrl'),
				fields: { url: fields['core.modules.marketplaceUrl'] ?? result.data.message }
			});
		}
	}
};
