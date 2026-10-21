/**
 * Einheitliche CSV-Erzeugung für alle Exporte (#34): UTF-8 mit BOM, `;` als Trenner, CRLF, Quote-Escaping und
 * **eine** Formelschutz-Regel. Rein (Browser und Server).
 *
 * Formelschutz (CSV-Injection): Jeder **Text**, der mit `=`, `+`, `-`, `@`, Tab oder CR beginnt, bekommt ein
 * führendes `'` – Tabellenkalkulationen werten ihn dann nicht als Formel aus. Echte Zahlen (`number`) und Beträge
 * aus `csvCents` werden unverändert ausgegeben, damit negative Werte („-12,50“) Zahlen bleiben. Numerisch
 * aussehende Texte werden **nicht** ausgenommen (sonst ließen sich Werte wie `-1+1` einschleusen).
 *
 *   csvDocument(['Name', 'Betrag'], [['=HYPERLINK(…)', csvCents(-1250)]])
 *   // → "\ufeffName;Betrag\r\n'=HYPERLINK(…);-12,50\r\n"
 */
import { centsPlain } from '$lib/components/layout/money';

const BOM = '\ufeff';

/** Vertrauenswürdiger Zahlenwert, der ohne Formelschutz ausgegeben wird (nur über `csvCents`/Zahlen erzeugt). */
export interface CsvNumber {
	readonly csvNumber: string;
}

export type CsvValue = string | number | boolean | null | undefined | CsvNumber;

/** Betrag in Cent als Zahl „-1234,50“ (ohne Tausenderpunkt, Komma als Dezimaltrenner). */
export function csvCents(cents: number): CsvNumber {
	return { csvNumber: centsPlain(cents) };
}

function isCsvNumber(v: unknown): v is CsvNumber {
	return typeof v === 'object' && v !== null && typeof (v as CsvNumber).csvNumber === 'string';
}

/** Eine Zelle: Formelschutz für Texte, Anführungszeichen bei `;`, `"`, CR oder LF. */
export function csvCell(value: CsvValue): string {
	let s: string;
	if (value === null || value === undefined) s = '';
	else if (isCsvNumber(value)) s = value.csvNumber;
	else if (typeof value === 'number')
		s = Number.isFinite(value) ? String(value).replace('.', ',') : '';
	else if (typeof value === 'boolean') s = String(value);
	else {
		s = String(value);
		if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
	}
	return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Eine Zeile (ohne Zeilenende) */
export function csvRow(values: readonly CsvValue[]): string {
	return values.map(csvCell).join(';');
}

/** Ganze Datei: BOM, Kopfzeile, Zeilen, jede mit CRLF abgeschlossen. Kopfzeilen werden wie Texte geschützt. */
export function csvDocument(
	header: readonly string[],
	rows: readonly (readonly CsvValue[])[]
): string {
	return BOM + [header, ...rows].map((r) => csvRow(r) + '\r\n').join('');
}

export interface CsvColumn {
	key: string;
	label: string;
}

/** Tabelle aus Objekten: Spalten = `columns` (Kopfzeile = `label`, Wert = `row[key]`). */
export function csvFromRecords(
	rows: readonly Record<string, unknown>[],
	columns: readonly CsvColumn[]
): string {
	return csvDocument(
		columns.map((c) => c.label),
		rows.map((r) => columns.map((c) => toCsvValue(r[c.key])))
	);
}

function toCsvValue(v: unknown): CsvValue {
	if (v === null || v === undefined) return v;
	if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
	if (isCsvNumber(v)) return v;
	return String(v);
}
