import { selectProfileSections } from '$lib/sdk/client/profile-sections';
import type { ProfileSection } from '$lib/sdk/types/module-ui';
import { moduleUiLoader } from '$lib/sdk/client/module-ui-registry';
import type { PageLoad } from './$types';

/**
 * Modul-Oberflächen aus dem Modulverzeichnis (`moduleUiLoader`). Hier werden nur die `profileSections` aktiver Module
 * (und mit vorhandenem Recht) ausgewählt; die Komponenten laden ihre Daten selbst per `apiFetch`.
 */

export const load: PageLoad = async ({ data }) => {
	const byModule: Record<string, ProfileSection[]> = {};
	await Promise.all(
		data.activeModules.map(async (moduleId) => {
			const loader = moduleUiLoader(moduleId);
			if (!loader) return;
			const sections = (await loader()).default.profileSections;
			if (sections?.length) byModule[moduleId] = sections;
		})
	);
	return {
		...data,
		/** Sortiert, gefiltert; `key` = `<moduleId>:<id>`, `component` = Lader der Svelte-Komponente */
		sections: selectProfileSections(byModule, data.activeModules, data.permissions)
	};
};
