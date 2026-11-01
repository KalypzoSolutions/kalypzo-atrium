import { error } from '@sveltejs/kit';
import { adminTabs } from '$lib/components/layout/admin-registry';
import { t } from '$lib/i18n';
import type { LayoutServerLoad } from './$types';

/** Reiter der Einstellungen (Registry, nach Rechten gefiltert); ohne Reiter kein Zugriff. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) throw error(401, t('admin.errors.unauthenticated'));
	const tabs = adminTabs('settings', [...locals.ctx.permissions]).map((tab) => ({
		label: tab.label,
		href: tab.href,
		icon: tab.icon
	}));
	if (tabs.length === 0) throw error(403, t('admin.errors.forbidden'));
	return { settingsTabs: tabs };
};
