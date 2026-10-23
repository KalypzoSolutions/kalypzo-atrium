import { selectUserAdminSections } from '$lib/sdk/client/profile-sections';
import type { ModuleUi, UserAdminSection } from '$lib/sdk/types/module-ui';
import type { PageLoad } from './$types';

/**
 * Build-Zeit-Registry der Modul-Oberflächen: `userAdminSections` aktiver Module (mit vorhandenem Recht) für den
 * Dialog „Benutzer bearbeiten“; die Komponenten laden und speichern ihre Daten selbst per `apiFetch`.
 */
const uis = import.meta.glob<{ default: ModuleUi }>('/src/lib/modules/*/ui.ts');

export const load: PageLoad = async ({ data }) => {
	const byModule: Record<string, UserAdminSection[]> = {};
	await Promise.all(
		data.activeModules.map(async (moduleId) => {
			const loader = uis[`/src/lib/modules/${moduleId}/ui.ts`];
			if (!loader) return;
			const sections = (await loader()).default.userAdminSections;
			if (sections?.length) byModule[moduleId] = sections;
		})
	);
	return {
		...data,
		/** Sortiert, gefiltert; `key` = `<moduleId>:<id>` */
		userSections: selectUserAdminSections(byModule, data.activeModules, data.ownPermissions)
	};
};
