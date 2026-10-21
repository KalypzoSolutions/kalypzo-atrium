/**
 * Zeilen- und Wert-Helfer für rohe Abfragen (`tx.execute(sql…)`), gemeinsam für Core und Module
 * (Module nutzen sie über `$lib/sdk/server`). Ersetzt die früher je Datei kopierten `rowsOf`/`iso`/`idList`.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from './client';

/** Eine Ergebniszeile von `tx.execute` (Spaltenname → Wert, Treiber-abhängige Typen) */
export type Row = Record<string, unknown>;

/** Zeilen einer rohen Abfrage (`pg` und PGlite liefern beide `{ rows }`) */
export async function rowsOf(tx: DbOrTx, query: SQL): Promise<Row[]> {
	return ((await tx.execute(query)) as unknown as { rows: Row[] }).rows;
}

/** Zeilen aus einem bereits ausgeführten Ergebnis (`await tx.execute(…)`), fehlende `rows` → `[]` */
export function resultRows(result: unknown): Row[] {
	return ((result as { rows?: Row[] } | null | undefined)?.rows ?? []) as Row[];
}

/**
 * Werteliste für `IN (…)`: `sql\`x IN (${inList(ids)})\``. Eine **leere** Liste ergibt `NULL`, d. h.
 * `x IN (NULL)` trifft nie (statt eines SQL-Syntaxfehlers bei `IN ()`). Achtung: `NOT IN (NULL)` trifft
 * ebenfalls nie – für „nicht in leerer Liste“ vorher selbst prüfen.
 */
export function inList(values: readonly unknown[]): SQL {
	if (values.length === 0) return sql`NULL`;
	return sql.join(
		values.map((v) => sql`${v}`),
		sql`, `
	);
}

/**
 * Zeitstempel als ISO-String. `pg` liefert `Date` (inkl. Millisekunden), PGlite Strings
 * (`2026-10-20 12:34:56.345+00`). `new Date(String(date))` würde die Millisekunden verlieren, daher der
 * `Date`-Zweig. Nicht lesbare Werte kommen unverändert als String zurück (kein Wurf).
 */
export function toIso(v: unknown): string {
	const d = v instanceof Date ? v : new Date(String(v));
	return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** Wie `toIso`, `null`/`undefined` → `null` */
export function toIsoOrNull(v: unknown): string | null {
	return v === null || v === undefined ? null : toIso(v);
}

/** Spaltenwert als String, `null`/`undefined` → `null` */
export function str(v: unknown): string | null {
	return v === null || v === undefined ? null : String(v);
}

/** Spaltenwert als Zahl, `null`/`undefined` → `0` (bigint/numeric kommen als String) */
export function num(v: unknown): number {
	return Number(v ?? 0);
}
