import { error } from '@sveltejs/kit';
import { matchModuleRoute } from '$lib/sdk/client/routes';
import type { ModuleUi } from '$lib/sdk/types/module-ui';
import type { PageLoad } from './$types';

/**
 * Build-Zeit-Registry der Modul-Oberflaechen. Die Aktivierung wird serverseitig in
 * +page.server.ts geprueft; hier wird nur die Komponente aufgeloest.
 */
const uis = import.meta.glob<{ default: ModuleUi }>('/src/lib/modules/*/ui.ts');

export const load: PageLoad = async ({ data }) => {
	const loader = uis[`/src/lib/modules/${data.moduleId}/ui.ts`];
	if (!loader) throw error(404, 'Das Modul stellt keine Oberfläche bereit');
	const ui = (await loader()).default;
	const match = matchModuleRoute(Object.keys(ui.routes), data.path);
	const route = match && ui.routes[match.key];
	if (!match || !route) throw error(404, 'Seite nicht gefunden');
	const component = (await route()).default;
	return { ...data, component, params: match.params };
};
