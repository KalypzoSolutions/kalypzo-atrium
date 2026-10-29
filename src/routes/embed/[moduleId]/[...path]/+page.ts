import { error } from '@sveltejs/kit';
import { matchModuleRoute } from '$lib/sdk/client/routes';
import type { ModuleUi } from '$lib/sdk/types/module-ui';
import type { PageLoad } from './$types';

/** Build-Zeit-Registry der Modul-Oberflächen; eingebettet werden nur `ui.embedRoutes` */
const uis = import.meta.glob<{ default: ModuleUi }>('/src/lib/modules/*/ui.ts');

export const load: PageLoad = async ({ data }) => {
	const loader = uis[`/src/lib/modules/${data.moduleId}/ui.ts`];
	if (!loader) throw error(404, 'Das Modul stellt keine Oberfläche bereit');
	const routes = (await loader()).default.embedRoutes ?? {};
	const match = matchModuleRoute(Object.keys(routes), data.path);
	const route = match && routes[match.key];
	if (!match || !route) throw error(404, 'Seite nicht gefunden');
	const component = (await route()).default;
	return { ...data, component, params: match.params };
};
