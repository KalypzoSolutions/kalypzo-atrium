/**
 * Voreinstellungen der Listen (Fahrt, Kontaktliste, Gesundheit, Minimal) und Schlüssel der Zusatzfeld-Spalten –
 * generisch für alle Listen mit Personen (Mitglieder, Teilnehmende).
 */
import { LIST_PRESET_KEYS, type ListColumn, type ListPreset } from './types';

/** Spaltenschlüssel eines Zusatzfelds (`field.<schlüssel>`) */
export const fieldColumnKey = (key: string) => `field.${key}`;

const PRESET_META: Record<keyof typeof LIST_PRESET_KEYS, { label: string; description: string }> = {
	fahrt: {
		label: 'Fahrt',
		description: 'Name, Gruppe, Alter, Notfall-Telefon, Ernährung, Allergien, Medikamente'
	},
	kontakt: { label: 'Kontaktliste', description: 'Name, Gruppe, Telefon, E-Mail' },
	gesundheit: {
		label: 'Gesundheit',
		description: 'Fahrt plus Gesundheit, Notfallkontakt, Schwimmen, Zecken/Tetanus, Krankenkasse'
	},
	minimal: { label: 'Minimal', description: 'Name, Gruppe, Alter' }
};

/** Voreinstellungen auf die vorhandenen Spalten beschränkt (deaktivierte Zusatzfelder entfallen) */
export function buildPresets(
	columns: ListColumn[],
	extra: Record<string, string[]> = {}
): ListPreset[] {
	const known = new Set(columns.map((c) => c.key));
	return (Object.keys(LIST_PRESET_KEYS) as (keyof typeof LIST_PRESET_KEYS)[]).map((id) => ({
		id,
		...PRESET_META[id],
		keys: [...LIST_PRESET_KEYS[id], ...(extra[id] ?? [])].filter((k) => known.has(k))
	}));
}
