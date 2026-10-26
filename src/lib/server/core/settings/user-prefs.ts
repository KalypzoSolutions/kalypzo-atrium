import { and, eq, inArray } from 'drizzle-orm';
import { activeThemeSchema, parseUserThemes, type UserTheme } from '$lib/appearance/schema';
import { styleString, themeCssVars } from '$lib/appearance/css';
import { resolveTheme } from '$lib/appearance/presets';
import { getDb, schema } from '../database/client';

export type Density = 'comfortable' | 'compact';
export type ThemeChoice = 'light' | 'dark' | 'system';

export interface UserPrefs {
	/** Wert aus der Datenbank (Standard `system`) */
	theme: ThemeChoice;
	/** `true`, wenn der Benutzer die Darstellung ausdrücklich gespeichert hat */
	themeExplicit: boolean;
	/** `''` oder `#rrggbb` */
	accentColor: string;
	density: Density;
	startPage: string;
	pageSize: number;
	/** Eigene Themes (ungültige Einträge verworfen) */
	themes: UserTheme[];
	/** Gewählte Theme-ID (`''` = kein Theme) */
	activeThemeId: string;
	/** Aufgelöstes aktives Theme (Vorschlag oder eigenes), sonst `null` */
	activeTheme: UserTheme | null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const START = /^\/(?!\/)[a-z0-9\-/]*$/;

/** Gibt nur eine gültige `#rrggbb`-Farbe zurück, sonst `null` (Schutz vor CSS-/HTML-Injektion). */
export function safeHexColor(v: unknown): string | null {
	return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null;
}

export function safeDensity(v: unknown): Density {
	return v === 'compact' ? 'compact' : 'comfortable';
}

/** Liest alle Darstellungs-Einstellungen eines Benutzers (eine Abfrage). */
export async function loadUserPrefs(userId: string): Promise<UserPrefs> {
	const keys = [
		'core.user.theme',
		'core.user.accentColor',
		'core.user.density',
		'core.user.startPage',
		'core.user.pageSize',
		'core.user.themes',
		'core.user.activeTheme'
	];
	const rows = await getDb()
		.select({ key: schema.setting.key, value: schema.setting.value })
		.from(schema.setting)
		.where(and(inArray(schema.setting.key, keys), eq(schema.setting.scopeId, userId)));
	const m = new Map(rows.map((r) => [r.key, r.value]));
	const theme = m.get('core.user.theme');
	const themeExplicit = theme === 'light' || theme === 'dark' || theme === 'system';
	const start = m.get('core.user.startPage');
	const size = Number(m.get('core.user.pageSize'));
	const themes = parseUserThemes(m.get('core.user.themes'));
	const active = activeThemeSchema.safeParse(m.get('core.user.activeTheme'));
	const activeTheme = active.success ? resolveTheme(active.data, themes) : null;
	return {
		theme: themeExplicit ? (theme as ThemeChoice) : 'system',
		themeExplicit,
		accentColor: safeHexColor(m.get('core.user.accentColor')) ?? '',
		density: safeDensity(m.get('core.user.density')),
		startPage: typeof start === 'string' && START.test(start) ? start : '/dashboard',
		pageSize: Number.isFinite(size) && size >= 10 && size <= 200 ? Math.floor(size) : 25,
		themes,
		activeThemeId: activeTheme?.id ?? '',
		activeTheme
	};
}

const pageSizeCache = new WeakMap<object, Promise<number | null>>();

/**
 * Einträge pro Seite für Listen: ausdrücklich gespeicherte Benutzereinstellung `core.user.pageSize`
 * (10-200), sonst `fallback` (Standard der jeweiligen Seite). Je Anfrage (`locals`) nur einmal gelesen.
 */
export async function resolvePageSize(
	locals: { user: { id: string } | null },
	fallback: number
): Promise<number> {
	if (!locals.user) return fallback;
	const userId = locals.user.id;
	let p = pageSizeCache.get(locals);
	if (!p) {
		p = getDb()
			.select({ value: schema.setting.value })
			.from(schema.setting)
			.where(and(eq(schema.setting.key, 'core.user.pageSize'), eq(schema.setting.scopeId, userId)))
			.then(([row]) => {
				const n = Number(row?.value);
				return Number.isFinite(n) && n >= 10 && n <= 200 ? Math.floor(n) : null;
			});
		pageSizeCache.set(locals, p);
	}
	return (await p) ?? fallback;
}

/** Erlaubte Startseiten: Dashboard, Profil und die Navigation aktiver Module (nach Rechten). */
export function allowedStartPages(navigationPaths: string[]): Set<string> {
	return new Set(['/dashboard', '/profile', ...navigationPaths]);
}

/** Startseite, die der Server tatsächlich verwendet (sonst `/dashboard`). */
export function resolveStartPage(startPage: string, navigationPaths: string[]): string {
	return START.test(startPage) && allowedStartPages(navigationPaths).has(startPage)
		? startPage
		: '/dashboard';
}

export interface Appearance {
	theme: string | undefined;
	density: unknown;
	/** Akzentfarbe des Benutzers oder des Systems */
	accent: unknown;
	/** Aktives Theme (Hintergrund); wird erneut validiert */
	appTheme?: UserTheme | null;
}

/** Wirksame Akzentfarbe: Theme → eigene → System → Standard */
export function effectiveAccent(prefs: UserPrefs | null, systemAccent: unknown): string {
	return (
		safeHexColor(prefs?.activeTheme?.accent) ||
		prefs?.accentColor ||
		safeHexColor(systemAccent) ||
		'#2563eb'
	);
}

/** CSS-Variablen des aktiven Themes (oder `null`, wenn keines aktiv bzw. ungültig ist) */
export function themeVarsFor(theme: UserTheme | null | undefined): Record<string, string> | null {
	if (!theme) return null;
	const [valid] = parseUserThemes([{ ...theme, id: crypto.randomUUID() }]);
	return valid ? themeCssVars(valid) : null;
}

/**
 * Ersetzt `%app.theme%`, `%app.density%`, `%app.apptheme%` und `%app.style%` in `app.html`
 * (Werte werden validiert).
 */
export function applyAppearance(html: string, a: Appearance): string {
	const accent = safeHexColor(a.accent);
	const vars = themeVarsFor(a.appTheme);
	const style = { ...(accent ? { '--accent-color': accent } : {}), ...(vars ?? {}) };
	return html
		.replace('%app.theme%', a.theme === 'dark' ? 'dark' : '')
		.replace('%app.density%', safeDensity(a.density))
		.replace('%app.apptheme%', vars ? 'on' : '')
		.replace('%app.style%', styleString(style));
}
