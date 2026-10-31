import { error } from '@sveltejs/kit';
import { matchModuleRoute } from '$lib/sdk/client/routes';
import type { ModuleUi } from '$lib/sdk/types/module-ui';
import type { PageLoad } from './$types';

/** Build-Zeit-Registry der Modul-Oberflächen; nur `publicRoutes` sind hier erreichbar. */
const uis = import.meta.glob<{ default: ModuleUi }>('/src/lib/modules/*/ui.ts');

export const load: PageLoad = async ({ data }) => {
	const loader = uis[`/src/lib/modules/${data.moduleId}/ui.ts`];
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
