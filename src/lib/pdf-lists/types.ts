import { t } from '$lib/i18n';
/**
 * Vertrag für konfigurierbare PDF-Listen (eine Zeile je Person, Spalten wählbar).
 * Rein (ohne Server-/Svelte-Importe): wird vom Server (Katalog, Zeilen, Layout) und von der
 * Oberfläche (`PdfExportDialog`) gemeinsam genutzt.
 */

/** Gruppierung der Spalten im Auswahl-Dialog */
export const LIST_COLUMN_GROUPS = ['person', 'contact', 'health', 'action'] as const;
export type ListColumnGroup = (typeof LIST_COLUMN_GROUPS)[number];

/** Anzeigenamen der Gruppen (beim Lesen übersetzt) */
export const LIST_COLUMN_GROUP_LABELS: Readonly<Record<ListColumnGroup, string>> = {
	get person() {
		return t('pdf-lists.groups.person');
	},
	get contact() {
		return t('pdf-lists.groups.contact');
	},
	get health() {
		return t('pdf-lists.groups.health');
	},
	get action() {
		return t('pdf-lists.groups.action');
	}
};

export interface ListColumn {
	/** Eindeutiger Schlüssel: `name`, `groups`, `age`, `emergencyPhone`, … bzw. `field.<zusatzfeld>` */
	key: string;
	label: string;
	group: ListColumnGroup;
	/** Relative Breite (Summe wird auf die Seitenbreite normalisiert) */
	weight: number;
	align?: 'left' | 'right' | 'center';
	/** Enthält Gesundheits-/sensible Angaben (Hinweis „vertraulich“ im PDF und im Dialog) */
	sensitive?: boolean;
}

export interface ListPreset {
	id: string;
	label: string;
	description?: string;
	/** Spaltenschlüssel in Katalogreihenfolge; unbekannte Schlüssel werden ignoriert */
	keys: string[];
}

export interface ListCatalog {
	columns: ListColumn[];
	presets: ListPreset[];
}

/** Auswahl des Nutzers (wird im Browser gemerkt und an den Server geschickt) */
export interface ListSelection {
	/** Zuletzt gewählte Voreinstellung (nur Anzeige); `custom`, sobald Spalten von Hand geändert wurden */
	preset?: string;
	columns: string[];
	/** Spalten ohne jeden Wert im PDF weglassen */
	hideEmpty: boolean;
}

/** Eine Zeile: Spaltenschlüssel → fertig formatierter Text (`\n` für Mehrzeiliges) */
export type ListRow = Record<string, string>;

export const DEFAULT_PRESET_ID = 'fahrt';
export const LIST_MAX_COLUMNS = 40;

/** Feste Presets (Schlüssel gelten für Mitglieder-Katalog; Aktions-Katalog ergänzt `role`, `fee`, `notes`) */
export const LIST_PRESET_KEYS = {
	fahrt: [
		'name',
		'groups',
		'age',
		'emergencyPhone',
		'field.ernaehrung',
		'field.allergien',
		'field.medikamente'
	],
	kontakt: ['name', 'groups', 'phone', 'email'],
	gesundheit: [
		'name',
		'groups',
		'age',
		'emergencyPhone',
		'field.ernaehrung',
		'field.allergien',
		'field.medikamente',
		'field.gesundheit',
		'field.notfallkontakt',
		'field.schwimmen',
		'field.zecken',
		'field.tetanus',
		'field.krankenkasse'
	],
	minimal: ['name', 'groups', 'age']
} as const;
