import { t } from '$lib/i18n';
/**
 * Aussehen von Objekten mit Icon und Farbe (Ordner in `files`, Kategorien in `material`):
 * Vorschlagsfarben und Zod-Bausteine. Client und Server; ob ein Icon existiert, prüft der Server
 * über `loadIconSet()` aus `$lib/sdk/icons`.
 */
import { z } from 'zod';

/** Vorschlagsfarben (Schnellwahl neben dem Farbwähler) */
/** Vorschlagsfarbe; der Name wird beim Lesen übersetzt */
const styleColorPreset = (
	value: string,
	key: string
): { readonly value: string; readonly label: string } => ({
	value,
	get label() {
		return t(`sdk.colors.${key}`);
	}
});

export const STYLE_COLORS: readonly { readonly value: string; readonly label: string }[] = [
	styleColorPreset('#2563eb', 'blue'),
	styleColorPreset('#16a34a', 'green'),
	styleColorPreset('#0d9488', 'teal'),
	styleColorPreset('#ca8a04', 'yellow'),
	styleColorPreset('#ea580c', 'orange'),
	styleColorPreset('#dc2626', 'red'),
	styleColorPreset('#db2777', 'pink'),
	styleColorPreset('#7c3aed', 'purple'),
	styleColorPreset('#92400e', 'brown'),
	styleColorPreset('#52525b', 'gray')
];

/** Farbe `#rrggbb` (wird klein gespeichert) */
export const styleColor = z
	.string()
	.trim()
	.regex(/^#[0-9a-fA-F]{6}$/, { error: () => t('sdk.style.invalidColor') })
	.transform((v) => v.toLowerCase());

/** Icon-Name aus der Icon-Bibliothek (`tree-pine`) */
export const styleIcon = z
	.string()
	.trim()
	.max(64, { error: () => t('sdk.style.invalidIcon') })
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: () => t('sdk.style.invalidIcon') });
