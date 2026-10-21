/**
 * Gemeinsame Hilfen für Personen-Listen als PDF (rein, ohne Server-Importe; genutzt von `members`
 * und `actions`): Datum/Alter/Feldwert formatieren, Quer-Vorlage wählen, Spalten auswählen und Blöcke bauen.
 * Mitglieder-Spaltenkatalog und Zeilen: `member-columns.ts`; Layout (Tabelle, Seitenumbruch): `layout.ts`.
 */
import type { FieldDefinition, FormValue } from '$lib/forms';
import { ageFromBirthDate, formatDateDe, todayBerlin } from '$lib/sdk/dates';
import { buildSectionedListBlocks, type ListSection } from './layout';
import {
	normalizeSelection,
	selectedColumns,
	selectionHasSensitive,
	visibleColumns
} from './select';
import type { ListCatalog, ListColumn, ListSelection } from './types';
import type { PdfBlock } from '$lib/sdk/types';

/** Briefkopf quer (A4 quer, 247 mm Textbreite); fehlt die Vorlage, dient `compact` in Querformat */
export const LIST_TEMPLATE = 'stamm-briefkopf-quer';
export const LIST_TEMPLATE_FALLBACK = 'compact';

/** Vorlage und Ausrichtung für `core.pdf.generate` (feste Stamm-Vorlagen bestimmen die Ausrichtung selbst) */
export function listTemplateInput(availableIds: string[]): {
	template: string;
	orientation: 'landscape';
} {
	return {
		template: availableIds.includes(LIST_TEMPLATE) ? LIST_TEMPLATE : LIST_TEMPLATE_FALLBACK,
		orientation: 'landscape'
	};
}

/** `2026-03-07` → `07.03.2026` (zentral in `$lib/sdk/dates`) */
export { formatDateDe };

/** Alter in Jahren am Stichtag; `null` bei ungültigem Datum oder Geburtsdatum nach dem Stichtag */
export function ageOn(birthDate: string | null | undefined, today: string): number | null {
	const age = ageFromBirthDate(birthDate, today);
	return age !== null && age >= 0 ? age : null;
}

/** Wert eines Zusatzfelds lesbar machen (Auswahl → Beschriftung, Ja/Nein, Listen mit Komma); leer → '' */
export function formatFieldValue(field: FieldDefinition | undefined, value: FormValue): string {
	if (value === null || value === undefined || value === '') return '';
	if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
	const label = (v: string) => {
		const options = field && 'options' in field ? field.options : [];
		return options.find((o) => o.value === v)?.label ?? v;
	};
	if (Array.isArray(value)) return value.map(label).join(', ');
	if (field?.type === 'date' && typeof value === 'string') return formatDateDe(value);
	return typeof value === 'string' ? label(value) : String(value);
}

/** Heute in Europe/Berlin – Stichtag für Alter und „Stand“ */
export const todayIso = (): string => todayBerlin();

/**
 * Wählt die Spalten (Auswahl des Nutzers gegen den Katalog, ohne Auswahl „Fahrt“), blendet leere Spalten aus
 * und baut die Blöcke (je Abschnitt eine Tabelle, ab dem zweiten eine neue Seite).
 */
export function composeListBlocks(p: {
	catalog: ListCatalog;
	selection?: Partial<ListSelection>;
	sections: ListSection[];
	generatedOn: string;
}): { blocks: PdfBlock[]; selection: ListSelection; columns: ListColumn[] } {
	const selection = normalizeSelection(p.selection, p.catalog.columns, p.catalog.presets);
	const chosen = selectedColumns(selection, p.catalog.columns);
	const columns = visibleColumns(
		chosen,
		p.sections.flatMap((s) => s.rows),
		selection.hideEmpty
	);
	const blocks = buildSectionedListBlocks(p.sections, {
		columns,
		generatedOn: p.generatedOn,
		confidential: selectionHasSensitive({ columns: columns.map((c) => c.key) }, p.catalog.columns)
	});
	return { blocks, selection, columns };
}
