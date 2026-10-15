import { error } from '@sveltejs/kit';
import { getDefinition } from '$lib/server/core/modules/registry';
import { isModuleEnabled } from '$lib/server/core/modules/service';
import type { PageServerLoad } from './$types';

/**
 * Oeffentliche Modulseiten: kein Login noetig. Das Modul muss registriert und aktiv sein;
 * welche Pfade existieren, bestimmt `ui.publicRoutes` (Opt-in des Moduls).
 */
export const load: PageServerLoad = async ({ params }) => {
	const def = getDefinition(params.moduleId);
	if (!def || !(await isModuleEnabled(params.moduleId))) {
		throw error(404, 'Seite nicht verfügbar');
	}
	return {
		moduleId: params.moduleId,
		moduleName: def.manifest.name,
		path: (params.path ?? '').replace(/^\/+|\/+$/g, '')
	};
};
