import { selectUserAdminSections } from '$lib/sdk/client/profile-sections';
import type { UserAdminSection } from '$lib/sdk/types/module-ui';
import { moduleUiLoader } from '$lib/sdk/client/module-ui-registry';
import type { PageLoad } from './$types';

/**
 * Modul-Oberflächen aus dem Modulverzeichnis (`moduleUiLoader`): `userAdminSections` aktiver Module (mit vorhandenem Recht) für den
 * Dialog „Benutzer bearbeiten“; die Komponenten laden und speichern ihre Daten selbst per `apiFetch`.
 */

export const load: PageLoad = async ({ data }) => {
	const byModule: Record<string, UserAdminSection[]> = {};
	await Promise.all(
		data.activeModules.map(async (moduleId) => {
			const loader = moduleUiLoader(moduleId);
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
