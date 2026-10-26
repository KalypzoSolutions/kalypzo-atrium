/**
 * Persönliche Design-Themes (Client + Server): Akzentfarbe und Seitenhintergrund je Modus (hell/dunkel),
 * einfarbig oder als Verlauf. Alle Farben sind `#rrggbb` – daraus erzeugtes CSS kann nichts einschleusen.
 */
import { z } from 'zod';

export const THEMES_MAX = 20;
export const STOPS_MIN = 2;
export const STOPS_MAX = 6;
export const SPOTS_MAX = 5;
export const THEME_NAME_MAX = 40;
export const PRESET_PREFIX = 'preset:';

const hex = z
	.string()
	.regex(/^#[0-9a-fA-F]{6}$/, 'Ungültige Farbe (#rrggbb erwartet).')
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
		.min(1, 'Bitte einen Namen angeben.')
		.max(THEME_NAME_MAX, `Höchstens ${THEME_NAME_MAX} Zeichen.`),
	/** `''` = eigene bzw. System-Akzentfarbe behalten */
	accent: z.union([z.literal(''), hex]),
	light: themeModeSchema,
	dark: themeModeSchema
});

export const userThemesSchema = z
	.array(userThemeSchema)
	.max(THEMES_MAX, `Höchstens ${THEMES_MAX} eigene Themes.`)
	.refine((list) => new Set(list.map((t) => t.id)).size === list.length, 'Doppelte Theme-ID.');

/** `''` = kein Theme, `preset:<slug>` oder ID eines eigenen Themes */
export const activeThemeSchema = z.union([
	z.literal(''),
	z.uuid(),
	z.string().regex(/^preset:[a-z0-9-]{1,40}$/)
]);

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
