/**
 * Aussehen von Objekten mit Icon und Farbe (Ordner in `files`, Kategorien in `material`):
 * Vorschlagsfarben und Zod-Bausteine. Client und Server; ob ein Icon existiert, prüft der Server
 * über `loadIconSet()` aus `$lib/sdk/icons`.
 */
import { z } from 'zod';

/** Vorschlagsfarben (Schnellwahl neben dem Farbwähler) */
export const STYLE_COLORS: readonly { value: string; label: string }[] = [
	{ value: '#2563eb', label: 'Blau' },
	{ value: '#16a34a', label: 'Grün' },
	{ value: '#0d9488', label: 'Türkis' },
	{ value: '#ca8a04', label: 'Gelb' },
	{ value: '#ea580c', label: 'Orange' },
	{ value: '#dc2626', label: 'Rot' },
	{ value: '#db2777', label: 'Pink' },
	{ value: '#7c3aed', label: 'Lila' },
	{ value: '#92400e', label: 'Braun' },
	{ value: '#52525b', label: 'Grau' }
];

/** Farbe `#rrggbb` (wird klein gespeichert) */
export const styleColor = z
	.string()
	.trim()
	.regex(/^#[0-9a-fA-F]{6}$/, 'Farbe im Format #RRGGBB')
	.transform((v) => v.toLowerCase());

/** Icon-Name aus der Icon-Bibliothek (`tree-pine`) */
export const styleIcon = z
	.string()
	.trim()
	.max(64, 'Ungültiges Icon')
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Ungültiges Icon');
