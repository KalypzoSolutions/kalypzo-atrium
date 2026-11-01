import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { matchModuleRoute } from '$lib/sdk/client/routes';
import { moduleUiLoader } from '$lib/sdk/client/module-ui-registry';
import type { PageLoad } from './$types';

/**
 * Modul-Oberflächen aus dem Modulverzeichnis (`moduleUiLoader`). Die Aktivierung wird serverseitig in
 * +page.server.ts geprüft; hier wird nur die Komponente aufgelöst.
 */

export const load: PageLoad = async ({ data }) => {
	const loader = moduleUiLoader(data.moduleId);
	if (!loader) throw error(404, t('app.moduleNoUi'));
	const ui = (await loader()).default;
	const match = matchModuleRoute(Object.keys(ui.routes), data.path);
	const route = match && ui.routes[match.key];
	if (!match || !route) throw error(404, t('app.pageNotFound'));
	const component = (await route()).default;
	return {
		...data,
		component,
		params: match.params,
		fullBleed: ui.fullBleedRoutes?.includes(match.key) ?? false
	};
};
