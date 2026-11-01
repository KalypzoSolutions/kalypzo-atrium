import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { matchModuleRoute } from '$lib/sdk/client/routes';
import { moduleUiLoader } from '$lib/sdk/client/module-ui-registry';
import type { PageLoad } from './$types';

/** Modul-Oberflächen aus dem Modulverzeichnis (`moduleUiLoader`); eingebettet werden nur `ui.embedRoutes` */

export const load: PageLoad = async ({ data }) => {
	const loader = moduleUiLoader(data.moduleId);
	if (!loader) throw error(404, t('app.moduleNoUi'));
	const routes = (await loader()).default.embedRoutes ?? {};
	const match = matchModuleRoute(Object.keys(routes), data.path);
	const route = match && routes[match.key];
	if (!match || !route) throw error(404, t('app.pageNotFound'));
	const component = (await route()).default;
	return { ...data, component, params: match.params };
};
