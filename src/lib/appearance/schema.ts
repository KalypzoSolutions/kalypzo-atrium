/**
 * Persönliche Design-Themes (Client + Server): Akzentfarbe und Seitenhintergrund je Modus (hell/dunkel),
 * einfarbig oder als Verlauf. Alle Farben sind `#rrggbb` – daraus erzeugtes CSS kann nichts einschleusen.
 */
import { z } from 'zod';
import { t } from '$lib/i18n';

/** Zod-Fehlerparameter, erst beim Prüfen übersetzt */
const msg = (key: string, params?: Record<string, string>) => ({
	error: () => t(key, params)
});

export const THEMES_MAX = 20;
export const FAVORITES_MAX = 30;
export const STOPS_MIN = 2;
export const STOPS_MAX = 6;
export const SPOTS_MAX = 5;
export const THEME_NAME_MAX = 40;
export const PRESET_PREFIX = 'preset:';

const hex = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, msg('appearance.validation.invalidColor'))
	.transform((v) => v.toLowerCase());
const percent = z.number().min(0).max(100);

export const RADIAL_POSITIONS = [
	'top-left',
	'top',
	'top-right',
	'left',
	'center',
	'right',
	'bottom-left',
	'bottom',
	'bottom-right'
] as const;
export type RadialPosition = (typeof RADIAL_POSITIONS)[number];

export const stopSchema = z.object({ color: hex, pos: percent });
const stops = z.array(stopSchema).min(STOPS_MIN).max(STOPS_MAX);

export const spotSchema = z.object({
	color: hex,
	x: percent,
	y: percent,
	size: z.number().min(10).max(100)
});

export const backgroundSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('solid'), color: hex }),
	z.object({ kind: z.literal('linear'), angle: z.number().int().min(0).max(359), stops }),
	z.object({ kind: z.literal('radial'), at: z.enum(RADIAL_POSITIONS), stops }),
	z.object({
		kind: z.literal('mesh'),
		base: hex,
		spots: z.array(spotSchema).min(1).max(SPOTS_MAX)
	})
]);

export const SIDEBAR_STYLES = ['glass', 'tinted', 'solid'] as const;
export type SidebarStyle = (typeof SIDEBAR_STYLES)[number];

export const themeModeSchema = z.object({
	background: backgroundSchema,
	/** Abdeckung mit der Grundfarbe (`--background`) in Prozent – dämpft den Hintergrund für lesbaren Text */
	veil: z.number().int().min(0).max(90),
	sidebar: z.enum(SIDEBAR_STYLES)
});

export const userThemeSchema = z.object({
	id: z.uuid(),
	name: z
		.string()
		.trim()
		.min(1, msg('appearance.validation.nameRequired'))
		.max(THEME_NAME_MAX, msg('appearance.validation.nameMax', { max: String(THEME_NAME_MAX) })),
	/** `''` = eigene bzw. System-Akzentfarbe behalten */
	accent: z.union([z.literal(''), hex]),
	light: themeModeSchema,
	dark: themeModeSchema
});

export const userThemesSchema = z
	.array(userThemeSchema)
	.max(THEMES_MAX, msg('appearance.validation.themesMax', { max: String(THEMES_MAX) }))
	.refine(
		(list) => new Set(list.map((x) => x.id)).size === list.length,
		msg('appearance.validation.duplicateId')
	);

/** ID eines eigenen Themes (UUID) oder eines Vorschlags (`preset:<slug>`) */
export const themeIdSchema = z.union([z.uuid(), z.string().regex(/^preset:[a-z0-9-]{1,40}$/)]);

/** `''` = kein Theme, sonst eine Theme-ID */
export const activeThemeSchema = z.union([z.literal(''), themeIdSchema]);

/** Mit Stern markierte Themes (eigene oder Vorschläge) – nur sie stehen in der Kopfzeile */
export const themeFavoritesSchema = z
	.array(themeIdSchema)
	.max(FAVORITES_MAX, msg('appearance.validation.favoritesMax', { max: String(FAVORITES_MAX) }))
	.refine(
		(list) => new Set(list).size === list.length,
		msg('appearance.validation.duplicateFavorite')
	);

/** Liest gespeicherte Favoriten tolerant (ungültige/doppelte IDs fallen weg). */
export function parseFavorites(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	for (const v of value) {
		if (out.length >= FAVORITES_MAX) break;
		if (themeIdSchema.safeParse(v).success && !out.includes(v as string)) {
			out.push(v as string);
		}
	}
	return out;
}

export type GradientStop = z.infer<typeof stopSchema>;
export type MeshSpot = z.infer<typeof spotSchema>;
export type ThemeBackground = z.infer<typeof backgroundSchema>;
export type ThemeMode = z.infer<typeof themeModeSchema>;
export type BackgroundKind = ThemeBackground['kind'];
/** Eigene Themes haben eine UUID, Vorschläge die ID `preset:<slug>` */
export type UserTheme = Omit<z.infer<typeof userThemeSchema>, 'id'> & { id: string };

/** Auswahl für Profil und Kopfzeile (ohne vollständige Daten) */
export interface ThemeChoiceItem {
	id: string;
	name: string;
	preset: boolean;
	/** CSS-Hintergrund für die Vorschau-Kachel (hell / dunkel) */
	swatchLight: string;
	swatchDark: string;
	accent: string;
}

/** Liest eine gespeicherte Liste tolerant: ungültige Einträge werden verworfen. */
export function parseUserThemes(value: unknown): UserTheme[] {
	if (!Array.isArray(value)) return [];
	const out: UserTheme[] = [];
	const seen = new Set<string>();
	for (const item of value.slice(0, THEMES_MAX)) {
		const r = userThemeSchema.safeParse(item);
		if (r.success && !seen.has(r.data.id)) {
			seen.add(r.data.id);
			out.push(r.data);
		}
	}
	return out;
}
