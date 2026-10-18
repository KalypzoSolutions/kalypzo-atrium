import { redirect } from '@sveltejs/kit';
import { loadUserPrefs } from '$lib/server/core/settings/user-prefs';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, cookies }) => {
	if (!locals.user) {
		throw redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	// Theme: die Datenbank (ausdrücklich gespeicherte Wahl) gewinnt gegenüber dem Cookie (SSR-Quelle)
	const prefs = await loadUserPrefs(locals.user.id);
	if (prefs.themeExplicit && (cookies.get('theme') ?? 'system') !== prefs.theme) {
		cookies.set('theme', prefs.theme, {
			path: '/',
			maxAge: 60 * 60 * 24 * 365,
			sameSite: 'lax',
			httpOnly: false,
			secure: url.protocol === 'https:'
		});
	}
	return { theme: prefs.theme };
};
