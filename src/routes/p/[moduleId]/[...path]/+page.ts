import { error } from '@sveltejs/kit';
import { matchModuleRoute } from '$lib/sdk/client/routes';
import { moduleUiLoader } from '$lib/sdk/client/module-ui-registry';
import type { PageLoad } from './$types';

/** Modul-Oberflächen aus dem Modulverzeichnis (`moduleUiLoader`); nur `publicRoutes` sind hier erreichbar. */

export const load: PageLoad = async ({ data }) => {
	const loader = moduleUiLoader(data.moduleId);
	if (!loader) throw error(404, 'Seite nicht verfügbar');
	const ui = (await loader()).default;
	const routes = ui.publicRoutes ?? {};
	const match = matchModuleRoute(Object.keys(routes), data.path);
	const route = match && routes[match.key];
	if (!match || !route) throw error(404, 'Seite nicht verfügbar');
	const component = (await route()).default;
	const wide = (ui.publicWideRoutes ?? []).includes(match.key);
	return { ...data, component, params: match.params, wide };
};
