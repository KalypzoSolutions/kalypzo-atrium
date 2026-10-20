import type { DashboardWidget } from '$lib/sdk/types/module-ui';

/** Kacheln des Core (Modul-ID `core`, immer aktiv). Komponenten werden erst bei Bedarf geladen. */
export const CORE_DASHBOARD_WIDGETS: DashboardWidget[] = [
	{
		id: 'quick-links',
		title: 'Schnellzugriff',
		description: 'Direkte Links zu deinen Modulen.',
		order: 5,
		size: 'sm',
		component: () => import('./QuickLinksWidget.svelte')
	},
	{
		id: 'stats',
		title: 'Kennzahlen',
		description: 'Aktive Benutzer*innen, Module und API-Keys.',
		order: 900,
		size: 'md',
		anyPermission: ['core.users.view', 'core.modules.view', 'core.api.view'],
		component: () => import('./CoreStatsWidget.svelte')
	},
	{
		id: 'activity',
		title: 'Letzte Aktivitäten',
		description: 'Die neuesten Einträge im Audit-Log.',
		order: 910,
		size: 'md',
		permission: 'core.audit.view',
		defaultHidden: false,
		component: () => import('./CoreActivityWidget.svelte')
	}
];
