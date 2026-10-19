import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** `/admin/settings` → erster erlaubter Reiter. */
export const load: PageServerLoad = async ({ parent }) => {
	const { settingsTabs } = await parent();
	throw redirect(307, settingsTabs[0]!.href);
};
