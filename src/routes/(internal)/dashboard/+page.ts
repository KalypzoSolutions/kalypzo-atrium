import { CORE_DASHBOARD_WIDGETS } from '$lib/components/dashboard/core-widgets';
import { selectDashboardWidgets } from '$lib/sdk/client/dashboard-widgets';
import type { DashboardWidget } from '$lib/sdk/types/module-ui';
import { moduleUiLoader } from '$lib/sdk/client/module-ui-registry';
import type { PageLoad } from './$types';

/**
 * Modul-Oberflächen aus dem Modulverzeichnis (`moduleUiLoader`): `dashboardWidgets` aktiver Module plus Core-Kacheln,
 * gefiltert nach Rechten. Die Kacheln laden ihre Daten selbst.
 */

export const load: PageLoad = async ({ data, parent }) => {
	const { permissions } = await parent();
	const byModule: Record<string, DashboardWidget[]> = { core: CORE_DASHBOARD_WIDGETS };
	await Promise.all(
		data.activeModules.map(async (moduleId) => {
			const loader = moduleUiLoader(moduleId);
			if (!loader || moduleId === 'core') return;
			const widgets = (await loader()).default.dashboardWidgets;
			if (widgets?.length) byModule[moduleId] = widgets;
		})
	);
	return {
		...data,
		/** Sortiert, gefiltert; `key` = `<moduleId>:<id>`, `component` = Lader der Svelte-Komponente */
		widgets: selectDashboardWidgets(byModule, data.activeModules, permissions)
	};
};
