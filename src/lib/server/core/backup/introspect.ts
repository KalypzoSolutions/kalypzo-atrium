/**
 * Datensicherung – Struktur der Datenbank lesen (pg_catalog, läuft unter PostgreSQL und PGlite)
 * und Tabellen/Zeilen in Einfüge-Reihenfolge bringen (Fremdschlüssel-Eltern zuerst).
 */
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../database/client';
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from './types';
import { rowsOf } from '../database/rows';

/** Erlaubte SQL-Bezeichner (Schemas, Tabellen, Spalten) */
export const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function jsonArray(v: unknown): string[] {
	if (Array.isArray(v)) return v.map(String);
	if (typeof v === 'string' && v) return (JSON.parse(v) as unknown[]).map(String);
	return [];
}

const keyOf = (schema: string, table: string) => `${schema}.${table}`;

/**
 * Basistabellen (`r`/`p`) der angegebenen Schemas mit Spalten (`format_type`), Primärschlüssel und
 * Fremdschlüsseln (inkl. Ziel-Schema). Ergebnis nach Schema und Tabellenname sortiert.
 */
export async function loadTableInfo(db: DbOrTx, schemas: string[]): Promise<TableInfo[]> {
	const list = [...new Set(schemas)].filter((s) => IDENTIFIER.test(s));
	if (!list.length) return [];
	const inList = sql.join(
		list.map((s) => sql`${s}`),
		sql`, `
	);

	const tables = new Map<string, TableInfo>();
	const colRows = await rowsOf(
		db,
		sql`SELECT n.nspname::text AS schema_name, c.relname::text AS table_name,
				a.attname::text AS column_name, format_type(a.atttypid, a.atttypmod) AS column_type,
				a.attnotnull AS not_null
			FROM pg_catalog.pg_class c
			JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
			JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
			WHERE n.nspname IN (${inList}) AND c.relkind IN ('r', 'p') AND NOT c.relispartition
				AND a.attnum > 0 AND NOT a.attisdropped
			ORDER BY n.nspname, c.relname, a.attnum`
	);
	for (const r of colRows) {
		const schema = String(r.schema_name);
		const table = String(r.table_name);
		const k = keyOf(schema, table);
		let t = tables.get(k);
		if (!t) {
			t = { schema, table, columns: [], primaryKey: [], foreignKeys: [] };
			tables.set(k, t);
		}
		const col: ColumnInfo = {
			name: String(r.column_name),
			type: String(r.column_type),
			nullable: !(r.not_null === true || r.not_null === 't')
		};
		t.columns.push(col);
	}

	const conRows = await rowsOf(
		db,
		sql`SELECT con.contype::text AS kind, n.nspname::text AS schema_name, c.relname::text AS table_name,
				rn.nspname::text AS ref_schema, rc.relname::text AS ref_table,
				array_to_json(ARRAY(
					SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
					JOIN pg_catalog.pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
					ORDER BY k.ord))::text AS cols,
				array_to_json(ARRAY(
					SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
					JOIN pg_catalog.pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
					ORDER BY k.ord))::text AS ref_cols
			FROM pg_catalog.pg_constraint con
			JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
			JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
			LEFT JOIN pg_catalog.pg_class rc ON rc.oid = con.confrelid
			LEFT JOIN pg_catalog.pg_namespace rn ON rn.oid = rc.relnamespace
			WHERE con.contype IN ('p', 'f') AND n.nspname IN (${inList})
			ORDER BY n.nspname, c.relname, con.conname`
	);
	for (const r of conRows) {
		const t = tables.get(keyOf(String(r.schema_name), String(r.table_name)));
		if (!t) continue;
		const cols = jsonArray(r.cols);
		if (r.kind === 'p') {
			t.primaryKey = cols;
		} else {
			const fk: ForeignKeyInfo = {
				columns: cols,
				refSchema: String(r.ref_schema),
				refTable: String(r.ref_table),
				refColumns: jsonArray(r.ref_cols)
			};
			t.foreignKeys.push(fk);
		}
	}

	return [...tables.values()].sort((a, b) =>
		a.schema === b.schema ? a.table.localeCompare(b.table) : a.schema.localeCompare(b.schema)
	);
}

/** Fremdschlüssel einer Tabelle auf sich selbst (z. B. `parent_id` → `id`), sonst `null`. */
export function selfReference(t: TableInfo): ForeignKeyInfo | null {
	return t.foreignKeys.find((fk) => fk.refSchema === t.schema && fk.refTable === t.table) ?? null;
}

/** FK-Kante, die beim Einfügen zunächst `NULL` bleibt und danach gesetzt wird (bricht einen Zyklus) */
export interface DeferredForeignKey {
	schema: string;
	table: string;
	fk: ForeignKeyInfo;
}

/** Alle FK-Spalten nullbar (unbekannte Spalten gelten als nicht nullbar) */
export function isNullableForeignKey(t: TableInfo, fk: ForeignKeyInfo): boolean {
	return (
		fk.columns.length > 0 &&
		fk.columns.every((c) => t.columns.find((col) => col.name === c)?.nullable === true)
	);
}

/**
 * Tabellen so sortieren, dass FK-Eltern vor ihren Kindern kommen. Nur Kanten innerhalb der Menge
 * zählen, Eigenbezug wird ignoriert. Bei gleichrangigen Tabellen bleibt die Eingabereihenfolge.
 * Zyklen werden gebrochen, indem je Zyklus eine **nullbare** FK-Kante als verzögert markiert wird
 * (`deferred`: beim Einfügen `NULL`, danach per UPDATE setzen). Zyklus ohne nullbare Kante → Error.
 */
export function planInsertOrder(tables: TableInfo[]): {
	order: TableInfo[];
	deferred: DeferredForeignKey[];
} {
	const index = new Map<string, number>();
	tables.forEach((t, i) => {
		const k = keyOf(t.schema, t.table);
		if (!index.has(k)) index.set(k, i);
	});
	const unique = tables.filter((t, i) => index.get(keyOf(t.schema, t.table)) === i);
	const pos = new Map(unique.map((t, i) => [keyOf(t.schema, t.table), i]));
	// je Tabelle: Kanten (Eltern-Index, FK)
	const edges = unique.map((t) => {
		const self = keyOf(t.schema, t.table);
		const list: { parent: number; fk: ForeignKeyInfo }[] = [];
		for (const fk of t.foreignKeys) {
			const k = keyOf(fk.refSchema, fk.refTable);
			if (k === self) continue;
			const j = pos.get(k);
			if (j !== undefined) list.push({ parent: j, fk });
		}
		return list;
	});
	const done = new Set<number>();
	const out: TableInfo[] = [];
	const deferred: DeferredForeignKey[] = [];
	while (out.length < unique.length) {
		let next = -1;
		for (let i = 0; i < unique.length; i++) {
			if (done.has(i)) continue;
			if (edges[i]!.every((e) => done.has(e.parent))) {
				next = i;
				break;
			}
		}
		if (next < 0) {
			// Zyklus: erste nullbare Kante zwischen offenen Tabellen verzögern
			let broken = false;
			for (let i = 0; i < unique.length && !broken; i++) {
				if (done.has(i)) continue;
				const list = edges[i]!;
				const at = list.findIndex(
					(e) => !done.has(e.parent) && isNullableForeignKey(unique[i]!, e.fk)
				);
				if (at < 0) continue;
				deferred.push({ schema: unique[i]!.schema, table: unique[i]!.table, fk: list[at]!.fk });
				list.splice(at, 1);
				broken = true;
			}
			if (broken) continue;
			const rest = unique
				.filter((_, i) => !done.has(i))
				.map((t) => keyOf(t.schema, t.table))
				.join(', ');
			throw new Error(`Zyklische Fremdschlüssel zwischen Tabellen: ${rest}`);
		}
		done.add(next);
		out.push(unique[next]!);
	}
	return { order: out, deferred };
}

/** Wie `planInsertOrder`, nur die Reihenfolge. */
export function sortTablesForInsert(tables: TableInfo[]): TableInfo[] {
	return planInsertOrder(tables).order;
}

function valueKey(row: Record<string, unknown>, cols: string[]): string | null {
	const vals: string[] = [];
	for (const c of cols) {
		const v = row[c];
		if (v === null || v === undefined) return null;
		vals.push(typeof v === 'object' ? JSON.stringify(v) : String(v));
	}
	return JSON.stringify(vals);
}

/**
 * Zeilen einer Tabelle mit Eigenbezug so sortieren, dass Eltern vor Kindern kommen
 * (Breitensuche ab den Wurzeln, sonst Eingabereihenfolge). Verwaiste Zeilen (Elternteil fehlt) und
 * Zyklen kommen ans Ende – jeweils gefolgt von ihren Nachkommen. Ohne Eigenbezug unverändert.
 */
export function sortRowsSelfRef(
	rows: Record<string, unknown>[],
	t: TableInfo
): Record<string, unknown>[] {
	const fk = selfReference(t);
	if (!fk || rows.length < 2) return rows;
	const children = new Map<string, number[]>();
	const parentOf: (string | null)[] = [];
	rows.forEach((r, i) => {
		const own = valueKey(r, fk.refColumns);
		const parent = valueKey(r, fk.columns);
		// Zeile, die auf sich selbst zeigt, ist einfügbar wie eine Wurzel
		const p = parent !== null && parent === own ? null : parent;
		parentOf.push(p);
		if (p !== null) {
			const list = children.get(p) ?? [];
			list.push(i);
			children.set(p, list);
		}
	});
	const emitted = new Set<number>();
	const out: Record<string, unknown>[] = [];
	const emitFrom = (start: number) => {
		const queue = [start];
		emitted.add(start);
		while (queue.length) {
			const i = queue.shift()!;
			out.push(rows[i]!);
			const own = valueKey(rows[i]!, fk.refColumns);
			if (own === null) continue;
			for (const c of children.get(own) ?? []) {
				if (emitted.has(c)) continue;
				emitted.add(c);
				queue.push(c);
			}
		}
	};
	const ownKeys = new Set(rows.map((r) => valueKey(r, fk.refColumns)));
	// 1) Wurzeln, 2) Verwaiste (Elternteil nicht in der Tabelle), 3) Rest (Zyklen)
	for (let i = 0; i < rows.length; i++) if (parentOf[i] === null && !emitted.has(i)) emitFrom(i);
	for (let i = 0; i < rows.length; i++) {
		if (!emitted.has(i) && !ownKeys.has(parentOf[i]!)) emitFrom(i);
	}
	for (let i = 0; i < rows.length; i++) if (!emitted.has(i)) emitFrom(i);
	return out;
}
