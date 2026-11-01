import { t } from '$lib/i18n';
/**
 * Voreinstellungen der Listen (Fahrt, Kontaktliste, Gesundheit, Minimal) und Schlüssel der Zusatzfeld-Spalten –
 * generisch für alle Listen mit Personen (Mitglieder, Teilnehmende).
 */
import { LIST_PRESET_KEYS, type ListColumn, type ListPreset } from './types';

/** Spaltenschlüssel eines Zusatzfelds (`field.<schlüssel>`) */
export const fieldColumnKey = (key: string) => `field.${key}`;

/** Name und Beschreibung je Voreinstellung (Texte `pdf-lists.presets.<id>.*`, beim Aufruf übersetzt) */
function presetMeta(id: keyof typeof LIST_PRESET_KEYS): { label: string; description: string } {
	return {
		label: t(`pdf-lists.presets.${id}.label`),
		description: t(`pdf-lists.presets.${id}.description`)
	};
}

/** Voreinstellungen auf die vorhandenen Spalten beschränkt (deaktivierte Zusatzfelder entfallen) */
export function buildPresets(
	columns: ListColumn[],
	extra: Record<string, string[]> = {}
): ListPreset[] {
	const known = new Set(columns.map((c) => c.key));
	return (Object.keys(LIST_PRESET_KEYS) as (keyof typeof LIST_PRESET_KEYS)[]).map((id) => ({
		id,
		...presetMeta(id),
		keys: [...LIST_PRESET_KEYS[id], ...(extra[id] ?? [])].filter((k) => known.has(k))
	}));
}
