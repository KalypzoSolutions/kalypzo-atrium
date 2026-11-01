import type { ModuleUi } from '$lib/sdk/types/module-ui';

export default {
	routes: {
		'': () => import('./pages/BoardPage.svelte'),
		':id': () => import('./pages/NotePage.svelte')
	},
	fullBleedRoutes: [':id'],
	publicRoutes: {
		info: () => import('./pages/PublicInfo.svelte')
	},
	embedRoutes: {
		':id': () => import('./pages/NotePage.svelte')
	},
	dashboardWidgets: [
		{
			id: 'pins',
			title: 'Pinnwand',
			order: 90,
			size: 'sm',
			permission: 'fx-board.note.view',
			component: () => import('./pages/PinsWidget.svelte')
		}
	]
} satisfies ModuleUi;
