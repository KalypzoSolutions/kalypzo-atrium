/**
 * Datensicherung – Zeilen einfügen über `json_populate_recordset` (PostgreSQL wandelt die Werte selbst um,
 * dadurch keine pg/PGlite-Unterschiede bei jsonb, Arrays, Zeitstempeln oder bytea).
 *
 * `INSERT INTO "s"."t" (cols) SELECT x.cols FROM json_populate_recordset(NULL::"s"."t", $1::json) x
 *   WHERE <je Fremdschlüssel: eine FK-Spalte NULL ODER Elternzeile vorhanden> [AND <where>]
 *   ON CONFLICT DO NOTHING RETURNING …`
 *
 * Zeilen dürfen als Objekt oder als Roh-JSON-Text (eine ndjson-Zeile) übergeben werden – Rohtext bleibt
 * unverändert (keine Genauigkeitsverluste bei `bigint`/`numeric`). Bezeichner nur nach Prüfung (`IDENTIFIER`).
 *
 * Eigenbezug (z. B. Ordnerbaum): Die Zeilen kommen sortiert (Eltern zuerst). Innerhalb einer Anweisung sieht
 * die EXISTS-Prüfung die gerade eingefügten Zeilen nicht; deshalb wird der Batch in Runden eingefügt, bis
 * keine Zeile mehr hinzukommt (Tiefe des Baums im Batch). Zeilen, deren Elternteil fehlt, werden übersprungen.
 */
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../database/client';
import { IDENTIFIER, selfReference } from './introspect';
import type { ForeignKeyInfo, TableInfo } from './types';

export type InsertRow = Record<string, unknown> | string;

export interface InsertOptions {
	/** Zeilen mit fehlender FK-Elternzeile überspringen (Standard: ja) */
	onlyIfParent?: boolean;
	/** Zusätzlicher Filter (SQL aus Konstanten bzw. geprüften Namen), Spalten über Alias `x` */
	where?: string;
	/** Spalten der Quelle (z. B. aus `backup.json`); sonst aus den Objekt-Schlüsseln */
	sourceColumns?: string[];
	/** Werte dieser Spalte der eingefügten Zeilen als Text zurückgeben */
	returnColumn?: string;
}

export interface InsertResult {
	inserted: number;
	skipped: number;
	/** nur mit `returnColumn` */
	returned: string[];
}

const q = (name: string) => {
	if (!IDENTIFIER.test(name)) throw new Error(`Ungültiger Bezeichner: ${name}`);
	return `"${name}"`;
};

function fkCondition(fk: ForeignKeyInfo, present: Set<string>): string | null {
	if (!fk.columns.length || fk.columns.length !== fk.refColumns.length) return null;
	// Spalte nicht übernommen → Standardwert des Ziels, nicht prüfbar
	if (fk.columns.some((c) => !present.has(c))) return null;
	const anyNull = fk.columns.map((c) => `x.${q(c)} IS NULL`).join(' OR ');
	const match = fk.columns.map((c, i) => `p.${q(fk.refColumns[i]!)} = x.${q(c)}`).join(' AND ');
	return `(${anyNull} OR EXISTS (SELECT 1 FROM ${q(fk.refSchema)}.${q(fk.refTable)} p WHERE ${match}))`;
}

function columnsOf(t: TableInfo, rows: InsertRow[], source?: string[]): string[] {
	const target = t.columns.map((c) => c.name).filter((c) => IDENTIFIER.test(c));
	let present: Set<string>;
	if (source) present = new Set(source);
	else {
		present = new Set();
		for (const r of rows) {
			const obj = typeof r === 'string' ? (JSON.parse(r) as Record<string, unknown>) : r;
			for (const k of Object.keys(obj)) present.add(k);
		}
	}
	return target.filter((c) => present.has(c));
}

const toJsonArray = (rows: InsertRow[]) =>
	`[${rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join(',')}]`;

async function runInsert(
	tx: DbOrTx,
	t: TableInfo,
	cols: string[],
	rows: InsertRow[],
	conditions: string[],
	returning: string | null
): Promise<string[] | number> {
	const table = `${q(t.schema)}.${q(t.table)}`;
	const colList = cols.map(q).join(', ');
	const selList = cols.map((c) => `x.${q(c)}`).join(', ');
	const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
	const ret = returning ? `${q(returning)}::text AS v` : '1 AS v';
	const head = `WITH ins AS (INSERT INTO ${table} (${colList}) SELECT ${selList} FROM json_populate_recordset(NULL::${table}, `;
	const tail = `::json) x${where} ON CONFLICT DO NOTHING RETURNING ${ret}) `;
	const res = (await tx.execute(
		sql`${sql.raw(head)}${toJsonArray(rows)}${sql.raw(tail)}${sql.raw(
			returning ? 'SELECT v FROM ins' : 'SELECT count(*)::int AS v FROM ins'
		)}`
	)) as unknown as { rows: { v: unknown }[] };
	if (returning) return res.rows.map((r) => String(r.v));
	return Number(res.rows[0]?.v ?? 0);
}

/** Einen Batch Zeilen einfügen (Reihenfolge der Zeilen bleibt erhalten). */
export async function insertRows(
	tx: DbOrTx,
	t: TableInfo,
	rows: InsertRow[],
	opts: InsertOptions = {}
): Promise<InsertResult> {
	const result: InsertResult = { inserted: 0, skipped: 0, returned: [] };
	if (!rows.length) return result;
	const cols = columnsOf(t, rows, opts.sourceColumns);
	if (!cols.length) {
		result.skipped = rows.length;
		return result;
	}
	const present = new Set(cols);
	const self = selfReference(t);
	const conditions: string[] = [];
	if (opts.onlyIfParent !== false) {
		for (const fk of t.foreignKeys) {
			if (fk === self) continue;
			const c = fkCondition(fk, present);
			if (c) conditions.push(c);
		}
	}
	if (opts.where) conditions.push(`(${opts.where})`);
	if (opts.returnColumn && !present.has(opts.returnColumn)) {
		throw new Error(`Spalte ${opts.returnColumn} fehlt in ${t.schema}.${t.table}`);
	}

	const pk = t.primaryKey;
	const selfCond = self && opts.onlyIfParent !== false ? fkCondition(self, present) : null;
	if (!selfCond || pk.length !== 1 || !present.has(pk[0]!)) {
		// ohne Eigenbezug (oder nicht rundenweise möglich): eine Anweisung
		const r = await runInsert(tx, t, cols, rows, conditions, opts.returnColumn ?? null);
		if (typeof r === 'number') result.inserted = r;
		else {
			result.inserted = r.length;
			result.returned = r;
		}
		result.skipped = rows.length - result.inserted;
		return result;
	}

	// Eigenbezug: rundenweise, bis nichts mehr hinzukommt
	const pkCol = pk[0]!;
	const keyOf = (r: InsertRow): string => {
		const obj = typeof r === 'string' ? (JSON.parse(r) as Record<string, unknown>) : r;
		const v = obj[pkCol];
		return v === null || v === undefined ? '' : String(v);
	};
	let remaining = rows.map((r) => ({ row: r, key: keyOf(r) }));
	const returnCol = opts.returnColumn ?? null;
	for (;;) {
		const got = await runInsert(
			tx,
			t,
			cols,
			remaining.map((r) => r.row),
			[...conditions, selfCond],
			pkCol
		);
		const ids = got as string[];
		if (!ids.length) break;
		result.inserted += ids.length;
		const done = new Set(ids);
		if (returnCol) {
			for (const r of remaining) {
				if (!done.has(r.key)) continue;
				const obj =
					typeof r.row === 'string' ? (JSON.parse(r.row) as Record<string, unknown>) : r.row;
				result.returned.push(String(obj[returnCol]));
			}
		}
		remaining = remaining.filter((r) => !done.has(r.key));
		if (!remaining.length) break;
	}
	result.skipped = remaining.length;
	return result;
}
