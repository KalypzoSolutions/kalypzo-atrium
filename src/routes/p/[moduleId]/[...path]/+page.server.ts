import { error } from '@sveltejs/kit';
import { localized, t } from '$lib/i18n';
import { getDefinition } from '$lib/server/core/modules/registry';
import { isModuleEnabled } from '$lib/server/core/modules/service';
import { getSettings } from '$lib/server/core/settings/service';
import type { PageServerLoad } from './$types';

/**
 * Öffentliche Modulseiten: kein Login nötig. Das Modul muss registriert und aktiv sein;
 * welche Pfade existieren, bestimmt `ui.publicRoutes` (Opt-in des Moduls).
 */
export const load: PageServerLoad = async ({ params }) => {
	const def = getDefinition(params.moduleId);
	if (!def || !(await isModuleEnabled(params.moduleId))) {
		throw error(404, t('public.pageUnavailable'));
	}
	const legal = await getSettings(['core.legal.privacyUrl', 'core.legal.imprintUrl']);
	const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
	return {
		/** Rechtliche Links für die Fußzeile (Issue #28) */
		legal: {
			privacyUrl: text(legal['core.legal.privacyUrl']),
			imprintUrl: text(legal['core.legal.imprintUrl'])
		},
		moduleId: params.moduleId,
		moduleName: localized(def.manifest.name),
		path: (params.path ?? '').replace(/^\/+|\/+$/g, '')
	};
};
