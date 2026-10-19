import { error } from '@sveltejs/kit';
import { adminTabs } from '$lib/components/layout/admin-registry';
import type { LayoutServerLoad } from './$types';

/** Reiter der Einstellungen (Registry, nach Rechten gefiltert); ohne Reiter kein Zugriff. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	const tabs = adminTabs('settings', [...locals.ctx.permissions]).map((t) => ({
		label: t.label,
		href: t.href,
		icon: t.icon
	}));
	if (tabs.length === 0) throw error(403, 'Keine Berechtigung');
	return { settingsTabs: tabs };
};
