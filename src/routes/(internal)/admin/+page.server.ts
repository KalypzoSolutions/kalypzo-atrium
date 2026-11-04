import { error } from '@sveltejs/kit';
import { visibleAdminEntries } from '$lib/components/layout/admin-registry';
import { t } from '$lib/i18n';
import { adminOverviewStats } from '$lib/server/core/admin/overview-stats';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, locals }) => {
	const { permissions, navigation } = await parent();
	if (visibleAdminEntries(permissions, navigation).length === 0) {
		throw error(403, t('admin.overview.noAccess'));
	}
	// Kennzahlen je Recht; ein Fehler darf die Übersicht nicht verhindern
	const stats = await adminOverviewStats(locals.ctx).catch((e) => {
		console.error('[admin] Kennzahlen nicht ladbar:', (e as Error)?.message);
		return null;
	});
	return { stats };
};
