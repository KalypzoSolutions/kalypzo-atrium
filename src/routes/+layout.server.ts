import { navigationFor } from '$lib/server/core/modules/service';
import { getSetting } from '$lib/server/core/settings/service';
import { loadUserPrefs, safeHexColor } from '$lib/server/core/settings/user-prefs';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [systemName, systemAccent, prefs] = await Promise.all([
		getSetting<string>('core.system.name'),
		getSetting<string>('core.design.accentColor'),
		locals.user ? loadUserPrefs(locals.user.id) : Promise.resolve(null)
	]);
	const navigation = locals.user ? await navigationFor(locals.ctx) : [];
	return {
		user: locals.user,
		permissions: [...locals.ctx.permissions].sort(),
		navigation,
		systemName,
		/** Wirksame Akzentfarbe: eigene (falls gesetzt), sonst die des Systems */
		accentColor: prefs?.accentColor || safeHexColor(systemAccent) || '#2563eb',
		density: prefs?.density ?? 'comfortable'
	};
};
