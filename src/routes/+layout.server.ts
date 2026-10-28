import { brandingState, logoUrl } from '$lib/server/core/branding';
import { navigationFor } from '$lib/server/core/modules/service';
import { navBadgeCounts } from '$lib/server/core/navigation/badges';
import { getSetting, getSettings } from '$lib/server/core/settings/service';
import { choiceItem, PRESET_PREFIX } from '$lib/appearance';
import { effectiveAccent, loadUserPrefs, themeVarsFor } from '$lib/server/core/settings/user-prefs';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [systemName, systemAccent, prefs, branding, legal] = await Promise.all([
		getSetting<string>('core.system.name'),
		getSetting<string>('core.design.accentColor'),
		locals.user ? loadUserPrefs(locals.user.id) : Promise.resolve(null),
		brandingState(),
		getSettings(['core.legal.privacyUrl', 'core.legal.imprintUrl'])
	]);
	const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
	const navigation = locals.user ? await navigationFor(locals.ctx) : [];
	const navBadges = locals.user ? await navBadgeCounts(locals.ctx) : {};
	return {
		user: locals.user,
		permissions: [...locals.ctx.permissions].sort(),
		navigation,
		/** Zähler der Seitenleiste (Pfad → Zahl), Aktualisierung über `GET /api/v1/nav/badges` */
		navBadges,
		systemName,
		/** Logo für Seitenleiste und Login (`null` = keins hochgeladen) */
		logoUrl: logoUrl(branding),
		/** Datenschutz/Impressum für die Fußzeile öffentlicher Seiten (`LegalLinks`) */
		legal: {
			privacyUrl: text(legal['core.legal.privacyUrl']),
			imprintUrl: text(legal['core.legal.imprintUrl'])
		},
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
