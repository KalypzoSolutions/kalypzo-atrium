import { selectProfileSections } from '$lib/sdk/client/profile-sections';
import type { ModuleUi, ProfileSection } from '$lib/sdk/types/module-ui';
import type { PageLoad } from './$types';

/**
 * Build-Zeit-Registry der Modul-Oberflächen. Hier werden nur die `profileSections` aktiver Module
 * (und mit vorhandenem Recht) ausgewählt; die Komponenten laden ihre Daten selbst per `apiFetch`.
 */
const uis = import.meta.glob<{ default: ModuleUi }>('/src/lib/modules/*/ui.ts');

export const load: PageLoad = async ({ data }) => {
	const byModule: Record<string, ProfileSection[]> = {};
	await Promise.all(
		data.activeModules.map(async (moduleId) => {
			const loader = uis[`/src/lib/modules/${moduleId}/ui.ts`];
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
