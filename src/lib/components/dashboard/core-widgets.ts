import type { DashboardWidget } from '$lib/sdk/types/module-ui';

/** Kacheln des Core (Modul-ID `core`, immer aktiv). Komponenten werden erst bei Bedarf geladen. */
export const CORE_DASHBOARD_WIDGETS: DashboardWidget[] = [
	{
		id: 'todos',
		title: 'Zu erledigen',
		description: 'Offene Rechnungen, Fristen und Aufgaben aus allen Modulen.',
		order: 1,
		size: 'lg',
		component: () => import('./TodosWidget.svelte')
	},
	{
		id: 'week',
		title: 'Diese Woche',
		description: 'Gruppenstunden, Termine, Aktionen und Fristen von Montag bis Sonntag.',
		order: 2,
		size: 'lg',
		component: () => import('./WeekWidget.svelte')
	},
	{
		id: 'quick-links',
		title: 'Schnellzugriff',
		description: 'Direkte Links zu deinen Modulen.',
		order: 5,
		size: 'sm',
		defaultHidden: true,
		component: () => import('./QuickLinksWidget.svelte')
	},
	{
		id: 'stats',
		title: 'Kennzahlen',
		description: 'Aktive Benutzer*innen, Module und API-Keys.',
		order: 900,
		size: 'md',
		anyPermission: ['core.users.view', 'core.modules.view', 'core.api.view'],
		defaultHidden: true,
		component: () => import('./CoreStatsWidget.svelte')
	},
	{
		id: 'activity',
		title: 'Letzte Aktivitäten',
		description: 'Die neuesten Einträge im Audit-Log.',
		order: 910,
		size: 'md',
		permission: 'core.audit.view',
		defaultHidden: true,
		component: () => import('./CoreActivityWidget.svelte')
	}
];
