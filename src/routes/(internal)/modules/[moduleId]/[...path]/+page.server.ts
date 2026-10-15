import { error } from '@sveltejs/kit';
import { getDefinition } from '$lib/server/core/modules/registry';
import { isModuleEnabled } from '$lib/server/core/modules/service';
import type { PageServerLoad } from './$types';

/**
 * Guard fuer die Modul-Oberflaeche: Modul muss im Build vorhanden, laufzeitseitig aktiv und
 * der Benutzer mindestens einer Modulberechtigung berechtigt sein.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	const def = getDefinition(params.moduleId);
	if (!def || !(await isModuleEnabled(params.moduleId))) throw error(404, 'Modul nicht verfügbar');
	const perms = def.manifest.permissions;
	if (perms.length && !perms.some((p) => locals.ctx.permissions.has(p))) {
		throw error(403, 'Keine Berechtigung');
	}
	return {
		moduleId: params.moduleId,
		moduleName: def.manifest.name,
		path: (params.path ?? '').replace(/^\/+|\/+$/g, '')
	};
};
