/**
 * PDF-Blöcke für Listen (rein): eine Gitter-Tabelle je Abschnitt, Spaltenbreiten aus `weight`,
 * Kopfzeile wiederholt sich je Seite (Verhalten des Blocktyps `table`).
 */
import type { PdfBlock } from '$lib/sdk/types';
import type { ListColumn, ListRow } from './types';

/** Nutzbare Breite der Vorlage `stamm-briefkopf-quer` in mm (297 − 25 − 25) */
export const LIST_PAGE_WIDTH_MM = 247;
export const LIST_CONFIDENTIAL_NOTE =
	'Vertraulich: enthält personenbezogene Daten, teils Gesundheitsangaben. Nur für den vorgesehenen Zweck verwenden und danach vernichten.';

export interface ListBlockOptions {
	columns: ListColumn[];
	/** `JJJJ-MM-TT` */
	generatedOn: string;
	/** Hinweis „Vertraulich“ unter der Überschrift (bei sensiblen Spalten) */
	confidential?: boolean;
}

export interface ListSection {
	title: string;
	subtitle?: string;
	rows: ListRow[];
}

function dateDe(iso: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/** Relative Gewichte → mm (Summe = Seitenbreite); ungültige Gewichte zählen als 1 */
export function columnWidthsMm(columns: Pick<ListColumn, 'weight'>[]): number[] {
	const weights = columns.map((c) => (Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 1));
	const sum = weights.reduce((s, w) => s + w, 0) || 1;
	return weights.map((w) => Math.round(((w * LIST_PAGE_WIDTH_MM) / sum) * 10) / 10);
}

function sectionBlocks(
	s: ListSection,
	o: Required<Pick<ListBlockOptions, 'generatedOn'>> & ListBlockOptions
): PdfBlock[] {
	const count = `${s.rows.length} ${s.rows.length === 1 ? 'Person' : 'Personen'}`;
	const info = [s.subtitle, count].filter(Boolean).join(' · ');
	const blocks: PdfBlock[] = [
		{ type: 'heading', level: 2, text: s.title },
		{
			type: 'paragraph',
			text: `${info} · Stand ${dateDe(o.generatedOn)}${o.confidential ? `\n${LIST_CONFIDENTIAL_NOTE}` : ''}`
		}
	];
	if (!s.rows.length) {
		blocks.push({ type: 'paragraph', text: 'Keine Personen.' });
		return blocks;
	}
	blocks.push({
		type: 'table',
		variant: 'grid',
		columns: o.columns.map((c) => c.label),
		align: o.columns.map((c) => c.align ?? 'left'),
		widths: columnWidthsMm(o.columns),
		rows: s.rows.map((r) => o.columns.map((c) => r[c.key] ?? ''))
	});
	return blocks;
}

/** Ein Abschnitt (Überschrift, Info, Tabelle) */
export function buildListBlocks(
	p: ListBlockOptions & { title: string; subtitle?: string; rows: ListRow[] }
): PdfBlock[] {
	return sectionBlocks({ title: p.title, subtitle: p.subtitle, rows: p.rows }, p);
}

/** Mehrere Abschnitte; ab dem zweiten beginnt eine neue Seite */
export function buildSectionedListBlocks(
	sections: ListSection[],
	opts: ListBlockOptions
): PdfBlock[] {
	const blocks: PdfBlock[] = [];
	sections.forEach((s, i) => {
		if (i > 0) blocks.push({ type: 'pageBreak' });
		blocks.push(...sectionBlocks(s, opts));
	});
	return blocks;
}

/** Zeilen je Seite bei A4 quer (≈ 140 mm Text, einzeilige Zeilen); viele Spalten brechen häufiger um */
const ROWS_PER_PAGE = 20;
const MIN_ROWS_PER_PAGE = 8;

/** Grobe Seitenschätzung (nur für den Hinweis im Dialog); `sections` = Anzahl Abschnitte (je neue Seite) */
export function estimatePages(rowCount: number, columns: unknown[], sections = 1): number {
	const rows = Number.isFinite(rowCount) ? Math.max(0, Math.floor(rowCount)) : 0;
	const wrap = 1 + 0.15 * Math.max(0, columns.length - 6);
	const perPage = Math.max(MIN_ROWS_PER_PAGE, Math.floor(ROWS_PER_PAGE / wrap));
	return Math.max(1, Math.max(Math.max(1, Math.floor(sections)), Math.ceil(rows / perPage)));
}
