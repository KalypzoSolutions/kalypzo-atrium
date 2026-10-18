import { redirect } from '@sveltejs/kit';
import { navigationFor } from '$lib/server/core/modules/service';
import { loadUserPrefs, resolveStartPage } from '$lib/server/core/settings/user-prefs';
import type { PageServerLoad } from './$types';

/** `/` leitet auf die persoenliche Startseite (`core.user.startPage`), sonst auf das Dashboard. */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(303, '/dashboard');
	const [prefs, nav] = await Promise.all([
		loadUserPrefs(locals.user.id),
		navigationFor(locals.ctx)
	]);
	throw redirect(
		303,
		resolveStartPage(
			prefs.startPage,
			nav.map((n) => n.path)
		)
	);
};
