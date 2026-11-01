import { t } from '$lib/i18n';
/**
 * Theme → CSS (rein, Client + Server). Ausgaben entstehen nur aus validierten `#rrggbb`-Farben, Zahlen
 * und festen Schlüsselwörtern – sie dürfen daher ins `style`-Attribut von `<html>` (`%app.style%`).
 */
import {
	contrastRatio,
	oklchToRgb,
	parseHex,
	rgbToOklch,
	type RgbTuple
} from '$lib/components/ui/color-picker/contrast';
import type {
	SidebarStyle,
	ThemeBackground,
	ThemeChoiceItem,
	ThemeMode,
	UserTheme
} from './schema';

const clamp = (n: number, min: number, max: number) =>
	Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const pct = (n: number) => `${Math.round(clamp(n, 0, 100) * 10) / 10}%`;

/** Bildliste für `background-image` (einfarbig als gleichfarbiger Verlauf, damit sie sich stapeln lässt). */
export function cssBackground(bg: ThemeBackground): string {
	switch (bg.kind) {
		case 'solid':
			return `linear-gradient(${bg.color}, ${bg.color})`;
		case 'linear': {
			const stops = sortStops(bg.stops).map((s) => `${s.color} ${pct(s.pos)}`);
			return `linear-gradient(${Math.round(clamp(bg.angle, 0, 359))}deg, ${stops.join(', ')})`;
		}
		case 'radial': {
			const stops = sortStops(bg.stops).map((s) => `${s.color} ${pct(s.pos)}`);
			return `radial-gradient(at ${bg.at.replace('-', ' ')}, ${stops.join(', ')})`;
		}
		case 'mesh': {
			const spots = bg.spots.map(
				(s) =>
					`radial-gradient(circle at ${pct(s.x)} ${pct(s.y)}, ${s.color} 0%, ${s.color}00 ${pct(s.size)})`
			);
			return [...spots, `linear-gradient(${bg.base}, ${bg.base})`].join(', ');
		}
	}
}

function sortStops<T extends { pos: number }>(stops: T[]): T[] {
	return [...stops].sort((a, b) => a.pos - b.pos);
}

/** Seitenleiste je Stil (feste Werte, Bezug auf die Tokens des aktuellen Modus) */
export const SIDEBAR_CSS: Record<SidebarStyle, string> = {
	glass: 'color-mix(in oklab, var(--sidebar) 62%, transparent)',
	tinted: 'color-mix(in oklab, var(--primary) 14%, var(--sidebar))',
	solid: 'var(--sidebar)'
};

/** Alle Variablen, die `themeCssVars` setzt (zum Entfernen im Browser) */
export const THEME_VAR_KEYS = [
	'--app-bg-light',
	'--app-bg-dark',
	'--app-veil-light',
	'--app-veil-dark',
	'--app-sidebar-light',
	'--app-sidebar-dark'
] as const;

/** CSS-Variablen eines Themes für `<html>` (Auswahl hell/dunkel übernimmt `app.css`). */
export function themeCssVars(theme: Pick<UserTheme, 'light' | 'dark'>): Record<string, string> {
	return {
		'--app-bg-light': cssBackground(theme.light.background),
		'--app-bg-dark': cssBackground(theme.dark.background),
		'--app-veil-light': pct(theme.light.veil),
		'--app-veil-dark': pct(theme.dark.veil),
		'--app-sidebar-light': SIDEBAR_CSS[theme.light.sidebar],
		'--app-sidebar-dark': SIDEBAR_CSS[theme.dark.sidebar]
	};
}

/** Variablen als Inhalt eines `style`-Attributs */
export function styleString(vars: Record<string, string>): string {
	return Object.entries(vars)
		.map(([k, v]) => `${k}:${v}`)
		.join(';');
}

/** Grundfarben aus `app.css` (`--background` / `--foreground` / `--muted-foreground`) */
export const BASE_BACKGROUND: Record<'light' | 'dark', RgbTuple> = {
	light: oklchToRgb(1, 0, 0),
	dark: oklchToRgb(0.145, 0, 0)
};
const FOREGROUND: Record<'light' | 'dark', RgbTuple> = {
	light: oklchToRgb(0.145, 0, 0),
	dark: oklchToRgb(0.985, 0, 0)
};
const MUTED_FOREGROUND: Record<'light' | 'dark', RgbTuple> = {
	light: oklchToRgb(0.45, 0, 0),
	dark: oklchToRgb(0.72, 0, 0)
};

const toHex = ([r, g, b]: RgbTuple) =>
	`#${[r, g, b]
		.map((n) =>
			Math.round(clamp(n, 0, 255))
				.toString(16)
				.padStart(2, '0')
		)
		.join('')}`;

/** Vollständiger Hintergrund einer Vorschau (Abdeckung + Verlauf auf der Grundfarbe) */
export function previewBackground(mode: ThemeMode, scheme: 'light' | 'dark'): string {
	const base = toHex(BASE_BACKGROUND[scheme]);
	const veil = `${base}${Math.round((clamp(mode.veil, 0, 90) / 100) * 255)
		.toString(16)
		.padStart(2, '0')}`;
	return `linear-gradient(${veil}, ${veil}), ${cssBackground(mode.background)}, linear-gradient(${base}, ${base})`;
}

/** Alle Farben, die als Untergrund für Text vorkommen können */
export function backgroundColors(bg: ThemeBackground): string[] {
	switch (bg.kind) {
		case 'solid':
			return [bg.color];
		case 'linear':
		case 'radial':
			return bg.stops.map((s) => s.color);
		case 'mesh':
			return [bg.base, ...bg.spots.map((s) => s.color)];
	}
}

/** Farbe nach der Abdeckung (sRGB-Mischung, Näherung für `color-mix`) */
function veiled(color: RgbTuple, veil: number, scheme: 'light' | 'dark'): RgbTuple {
	const v = clamp(veil, 0, 90) / 100;
	const base = BASE_BACKGROUND[scheme];
	return color.map((c, i) => c * (1 - v) + base[i]! * v) as RgbTuple;
}

/** Kleinster Kontrast von Text (normal und gedämpft) auf dem Hintergrund eines Modus */
export function textContrast(
	mode: ThemeMode,
	scheme: 'light' | 'dark'
): { text: number; muted: number } {
	let text = 21;
	let muted = 21;
	for (const c of backgroundColors(mode.background)) {
		const rgb = parseHex(c);
		if (!rgb) continue;
		const bg = veiled(rgb, mode.veil, scheme);
		text = Math.min(text, contrastRatio(FOREGROUND[scheme], bg));
		muted = Math.min(muted, contrastRatio(MUTED_FOREGROUND[scheme], bg));
	}
	return { text, muted };
}

/** Empfohlene Mindestwerte: Text 4,5 : 1, gedämpfter Text 3 : 1 */
export function isReadable(mode: ThemeMode, scheme: 'light' | 'dark'): boolean {
	const c = textContrast(mode, scheme);
	return c.text >= 4.5 && c.muted >= 3;
}

/** Eine Farbe für den Dunkelmodus abdunkeln (Helligkeit stark senken, Sättigung leicht) */
export function darkenColor(hex: string): string {
	const rgb = parseHex(hex);
	if (!rgb) return hex;
	const [l, c, h] = rgbToOklch(rgb);
	return toHex(oklchToRgb(0.17 + l * 0.13, Math.min(c * 0.8, 0.12), h));
}

function mapColors(bg: ThemeBackground, f: (hex: string) => string): ThemeBackground {
	switch (bg.kind) {
		case 'solid':
			return { ...bg, color: f(bg.color) };
		case 'linear':
		case 'radial':
			return { ...bg, stops: bg.stops.map((s) => ({ ...s, color: f(s.color) })) };
		case 'mesh':
			return { ...bg, base: f(bg.base), spots: bg.spots.map((s) => ({ ...s, color: f(s.color) })) };
	}
}

/** „Dunkel aus Hell ableiten“: gleicher Aufbau, abgedunkelte Farben, halbe Abdeckung */
export function deriveDark(mode: ThemeMode): ThemeMode {
	return {
		background: mapColors(mode.background, darkenColor),
		veil: Math.round(mode.veil / 2),
		sidebar: mode.sidebar
	};
}

/** Ausgangspunkt für ein neues Theme */
export function blankTheme(id: string, name = t('appearance.newTheme')): UserTheme {
	const light: ThemeMode = {
		background: {
			kind: 'linear',
			angle: 135,
			stops: [
				{ color: '#dbeafe', pos: 0 },
				{ color: '#ede9fe', pos: 50 },
				{ color: '#fce7f3', pos: 100 }
			]
		},
		veil: 20,
		sidebar: 'glass'
	};
	return { id, name, accent: '', light, dark: deriveDark(light) };
}

/** Kachel für Auswahl-Listen */
export function choiceItem(theme: UserTheme, preset: boolean): ThemeChoiceItem {
	return {
		id: theme.id,
		name: theme.name,
		preset,
		accent: theme.accent,
		swatchLight: previewBackground(theme.light, 'light'),
		swatchDark: previewBackground(theme.dark, 'dark')
	};
}
