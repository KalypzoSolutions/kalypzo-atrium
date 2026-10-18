/**
 * Auswahl der Spalten (rein): Normalisierung der Nutzerauswahl gegen den Katalog,
 * Ausblenden leerer Spalten, Hinweis auf sensible Spalten.
 */
import {
	DEFAULT_PRESET_ID,
	LIST_MAX_COLUMNS,
	type ListColumn,
	type ListPreset,
	type ListRow,
	type ListSelection
} from './types';

/** Die Spalte `name` ist immer dabei und steht vorn */
export const NAME_COLUMN_KEY = 'name';
export const CUSTOM_PRESET_ID = 'custom';

/** Schlüssel in Katalogreihenfolge: unbekannte und doppelte entfallen, `name` immer vorn, Obergrenze beachtet */
function orderByCatalog(keys: Iterable<string>, catalog: ListColumn[]): string[] {
	const wanted = new Set(keys);
	const hasName = catalog.some((c) => c.key === NAME_COLUMN_KEY);
	if (hasName) wanted.add(NAME_COLUMN_KEY);
	const ordered = catalog.map((c) => c.key).filter((k) => wanted.has(k));
	if (hasName)
		ordered.sort((a, b) => Number(b === NAME_COLUMN_KEY) - Number(a === NAME_COLUMN_KEY));
	const capped = ordered.slice(0, LIST_MAX_COLUMNS);
	return capped.length || !catalog.length ? capped : [catalog[0]!.key];
}

/** Spaltenschlüssel einer Voreinstellung (normalisiert gegen den Katalog) */
export function presetColumns(preset: ListPreset, catalog: ListColumn[]): string[] {
	return orderByCatalog(preset.keys, catalog);
}

/**
 * Macht aus einer (evtl. fehlenden oder veralteten) Auswahl eine gültige:
 * ohne Spalten → Voreinstellung (`sel.preset`, sonst `fahrt`, sonst erste); `preset` bleibt nur erhalten,
 * wenn die Spalten genau der Voreinstellung entsprechen, sonst `custom`.
 */
export function normalizeSelection(
	sel: Partial<ListSelection> | undefined,
	catalog: ListColumn[],
	presets: ListPreset[]
): ListSelection {
	const hideEmpty = typeof sel?.hideEmpty === 'boolean' ? sel.hideEmpty : true;
	const byId = (id: string | undefined) => presets.find((p) => p.id === id);
	const given = Array.isArray(sel?.columns) ? sel.columns.filter((k) => typeof k === 'string') : [];
	const known = given.filter((k) => catalog.some((c) => c.key === k));

	if (!known.length) {
		const preset = byId(sel?.preset) ?? byId(DEFAULT_PRESET_ID) ?? presets[0];
		const columns = preset ? presetColumns(preset, catalog) : orderByCatalog([], catalog);
		return { preset: preset?.id ?? CUSTOM_PRESET_ID, columns, hideEmpty };
	}
	const columns = orderByCatalog(known, catalog);
	const match = presets.find((p) => {
		const keys = presetColumns(p, catalog);
		return keys.length === columns.length && keys.every((k, i) => k === columns[i]);
	});
	return { preset: match?.id ?? CUSTOM_PRESET_ID, columns, hideEmpty };
}

/** Ausgewählte Spalten als Katalogeinträge (Reihenfolge der Auswahl) */
export function selectedColumns(sel: Pick<ListSelection, 'columns'>, catalog: ListColumn[]) {
	return sel.columns
		.map((k) => catalog.find((c) => c.key === k))
		.filter((c): c is ListColumn => !!c);
}

const hasValue = (v: string | undefined) => !!v && v.trim() !== '';

/** Bei `hideEmpty` entfallen Spalten ohne jeden Wert (`name` bleibt immer) */
export function visibleColumns(
	columns: ListColumn[],
	rows: ListRow[],
	hideEmpty: boolean
): ListColumn[] {
	if (!hideEmpty) return columns;
	return columns.filter((c) => c.key === NAME_COLUMN_KEY || rows.some((r) => hasValue(r[c.key])));
}

/** Enthält die Auswahl Gesundheits-/sensible Spalten? */
export function selectionHasSensitive(
	sel: Pick<ListSelection, 'columns'>,
	catalog: ListColumn[]
): boolean {
	return sel.columns.some((k) => catalog.find((c) => c.key === k)?.sensitive === true);
}
