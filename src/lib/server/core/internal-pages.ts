/**
 * Gemeinsame Server-Loads der Seiten hinter dem Login: `(internal)`-Layout und schlanke Embed-Seiten
 * (`/embed/<modul>/…`) teilen Login-Pflicht, Theme-Abgleich und den Guard der Modul-Oberfläche.
 */
import { error, redirect, type Cookies } from '@sveltejs/kit';
import type { RequestContext } from '$lib/sdk/types';
import { getDefinition } from './modules/registry';
import { isModuleEnabled } from './modules/service';
import { loadUserPrefs } from './settings/user-prefs';

interface LayoutEvent {
	locals: App.Locals;
	url: URL;
	cookies: Cookies;
}

/** Login verlangen (sonst 303 auf `/login?redirectTo=…`) und den Theme-Cookie mit der gespeicherten Wahl abgleichen */
export async function loadInternalLayout({ locals, url, cookies }: LayoutEvent) {
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
}

/**
 * Guard für Modulseiten (`/modules/<id>/…`, `/embed/<id>/…`): Modul muss im Build vorhanden und aktiv sein,
 * der Benutzer mindestens ein Modulrecht haben.
 */
export async function guardModulePage(
	params: { moduleId: string; path?: string },
	locals: { user: unknown; ctx: RequestContext }
) {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	const def = getDefinition(params.moduleId);
	if (!def || !(await isModuleEnabled(params.moduleId))) throw error(404, 'Modul nicht verfügbar');
	const perms = def.manifest.permissions;
	if (perms.length && !perms.some((p) => locals.ctx.permissions.has(p))) {
		throw error(403, 'Keine Berechtigung');
	}
	return {
		moduleId: params.moduleId,
		moduleName: def.manifest.name,
		path: (params.path ?? '').replace(/^\/+|\/+$/g, '')
	};
}
