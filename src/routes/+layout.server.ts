import { navigationFor } from '$lib/server/core/modules/service';
import { navBadgeCounts } from '$lib/server/core/navigation/badges';
import { getSetting } from '$lib/server/core/settings/service';
import { choiceItem, PRESET_PREFIX } from '$lib/appearance';
import { effectiveAccent, loadUserPrefs, themeVarsFor } from '$lib/server/core/settings/user-prefs';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [systemName, systemAccent, prefs] = await Promise.all([
		getSetting<string>('core.system.name'),
		getSetting<string>('core.design.accentColor'),
		locals.user ? loadUserPrefs(locals.user.id) : Promise.resolve(null)
	]);
	const navigation = locals.user ? await navigationFor(locals.ctx) : [];
	const navBadges = locals.user ? await navBadgeCounts(locals.ctx) : {};
	return {
		user: locals.user,
		permissions: [...locals.ctx.permissions].sort(),
		navigation,
		/** Zähler der Seitenleiste (Pfad → Zahl), Aktualisierung über `GET /api/v1/nav/badges` */
		navBadges,
		systemName,
		/** Wirksame Akzentfarbe: aus dem Theme, sonst eigene (falls gesetzt), sonst die des Systems */
		accentColor: effectiveAccent(prefs, systemAccent),
		density: prefs?.density ?? 'comfortable',
		/** CSS-Variablen des aktiven Themes (`null` = kein Theme) */
		themeVars: themeVarsFor(prefs?.activeTheme),
		activeThemeId: prefs?.activeThemeId ?? '',
		/** Schnellwahl in der Kopfzeile: nur mit Stern markierte Themes */
		themeChoices: (prefs?.favorites ?? []).map((t) => choiceItem(t, t.id.startsWith(PRESET_PREFIX)))
	};
};
