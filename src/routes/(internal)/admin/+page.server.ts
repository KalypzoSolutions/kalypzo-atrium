import { error } from '@sveltejs/kit';
import { visibleAdminEntries } from '$lib/components/layout/admin-registry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { permissions, navigation } = await parent();
	if (visibleAdminEntries(permissions, navigation).length === 0) {
		throw error(403, 'Du hast keinen Zugriff auf die Verwaltung.');
	}
	return {};
};
