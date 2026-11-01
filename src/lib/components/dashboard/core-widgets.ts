import { t } from '$lib/i18n';
import type { DashboardWidget } from '$lib/sdk/types/module-ui';

/**
 * Kacheln des Core (Modul-ID `core`, immer aktiv). Komponenten werden erst bei Bedarf geladen.
 * Titel/Beschreibung als Getter: übersetzt erst beim Zugriff (Sprache des Requests), nicht beim Import.
 */
export const CORE_DASHBOARD_WIDGETS: DashboardWidget[] = [
	{
		id: 'todos',
		get title() {
			return t('widgets.todos.title');
		},
		get description() {
			return t('widgets.todos.description');
		},
		order: 1,
		size: 'lg',
		component: () => import('./TodosWidget.svelte')
	},
	{
		id: 'week',
		get title() {
			return t('widgets.week.title');
		},
		get description() {
			return t('widgets.week.description');
		},
		order: 2,
		size: 'lg',
		component: () => import('./WeekWidget.svelte')
	},
	{
		id: 'quick-links',
		get title() {
			return t('widgets.quickLinks.title');
		},
		get description() {
			return t('widgets.quickLinks.description');
		},
		order: 5,
		size: 'sm',
		defaultHidden: true,
		component: () => import('./QuickLinksWidget.svelte')
	},
	{
		id: 'stats',
		get title() {
			return t('widgets.stats.title');
		},
		get description() {
			return t('widgets.stats.description');
		},
		order: 900,
		size: 'md',
		anyPermission: ['core.users.view', 'core.modules.view', 'core.api.view'],
		defaultHidden: true,
		component: () => import('./CoreStatsWidget.svelte')
	},
	{
		id: 'activity',
		get title() {
			return t('widgets.activity.title');
		},
		get description() {
			return t('widgets.activity.description');
		},
		order: 910,
		size: 'md',
		permission: 'core.audit.view',
		defaultHidden: true,
		component: () => import('./CoreActivityWidget.svelte')
	}
];
