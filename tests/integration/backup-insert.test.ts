/** Datensicherung: `insertRows` (json_populate_recordset) unter PGlite – Typen, FK-Filter, Konflikte, Eigenbezug. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb } from '$lib/server/core/database/client';
import { insertRows } from '$lib/server/core/backup/insert';
import { loadTableInfo, sortRowsSelfRef } from '$lib/server/core/backup/introspect';
import type { TableInfo } from '$lib/server/core/backup/types';

let close: () => Promise<void>;
let tables: Map<string, TableInfo>;
const T = (name: string) => tables.get(`bk_test.${name}`)!;

async function rows(query: string) {
	return ((await getDb().execute(sql.raw(query))) as unknown as { rows: Record<string, unknown>[] })
		.rows;
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	for (const s of [
		`CREATE SCHEMA bk_test`,
		`CREATE TABLE bk_test.parents (id text PRIMARY KEY, name text NOT NULL)`,
		`CREATE TABLE bk_test.types (
			id text PRIMARY KEY,
			parent_id text REFERENCES bk_test.parents(id),
			data jsonb NOT NULL DEFAULT '{}',
			tags text[],
			at timestamptz,
			blob bytea,
			flag boolean NOT NULL DEFAULT false,
			n integer,
			big bigint,
			day date,
			note text DEFAULT 'standard'
		)`,
		`CREATE TABLE bk_test.nodes (id text PRIMARY KEY, parent_id text REFERENCES bk_test.nodes(id), name text)`
	]) {
		await getDb().execute(sql.raw(s));
	}
	tables = new Map(
		(await loadTableInfo(getDb(), ['bk_test'])).map((t) => [`${t.schema}.${t.table}`, t])
	);
});

afterAll(async () => {
	await close();
});

describe('insertRows', () => {
	it('Roundtrip der Typen über row_to_json', async () => {
		await insertRows(getDb(), T('parents'), [{ id: 'p1', name: 'Eltern' }]);
		await getDb().execute(
			sql.raw(`INSERT INTO bk_test.types VALUES ('src', 'p1', '{"a":[1,2,{"b":"ü"}],"s":"enc:v1:x"}',
				ARRAY['a','b,c','d"e'], '2026-10-20T10:11:12.345Z', '\\x00ff10'::bytea, true, 42,
				9007199254740993, '2026-02-28', NULL)`)
		);
		const [src] = await rows(`SELECT row_to_json(t)::text AS j FROM bk_test.types t`);
		const line = String(src!.j).replace('"id":"src"', '"id":"copy"');
		const r = await insertRows(getDb(), T('types'), [line]);
		expect(r).toEqual({ inserted: 1, skipped: 0, returned: [] });
		const [a, b] = await rows(
			`SELECT id, data::text AS data, tags, at, encode(blob, 'hex') AS blob, flag, n, big::text AS big, day::text AS day, note
				FROM bk_test.types ORDER BY id DESC`
		);
		const strip = (x: Record<string, unknown>) => {
			const { id: _id, ...rest } = x;
			void _id;
			return { ...rest, at: new Date(String(rest.at)).toISOString() };
		};
		expect(strip(a!)).toEqual(strip(b!));
		expect(a!.tags).toEqual(['a', 'b,c', 'd"e']);
		expect(a!.blob).toBe('00ff10');
		expect(a!.big).toBe('9007199254740993');
		expect(a!.note).toBeNull();
		expect(JSON.parse(String(a!.data))).toEqual({ a: [1, 2, { b: 'ü' }], s: 'enc:v1:x' });
	});

	it('jsonb mit Zeichenkette auf oberster Ebene', async () => {
		await insertRows(getDb(), T('types'), [{ id: 'str', data: 'enc:v1:abc' }]);
		const [r] = await rows(
			`SELECT data #>> '{}' AS v, jsonb_typeof(data) AS t FROM bk_test.types WHERE id = 'str'`
		);
		expect(r).toEqual({ v: 'enc:v1:abc', t: 'string' });
	});

	it('fehlende Spalten bekommen den Standardwert des Ziels', async () => {
		await insertRows(getDb(), T('types'), [{ id: 'def' }]);
		const [r] = await rows(`SELECT flag, note FROM bk_test.types WHERE id = 'def'`);
		expect(r).toEqual({ flag: false, note: 'standard' });
	});

	it('FK-Filter: fehlende Eltern → übersprungen, NULL → eingefügt', async () => {
		const r = await insertRows(getDb(), T('types'), [
			{ id: 'fk1', parent_id: 'gibtsnicht' },
			{ id: 'fk2', parent_id: null },
			{ id: 'fk3', parent_id: 'p1' }
		]);
		expect(r.inserted).toBe(2);
		expect(r.skipped).toBe(1);
		const ids = (await rows(`SELECT id FROM bk_test.types WHERE id LIKE 'fk%' ORDER BY id`)).map(
			(x) => x.id
		);
		expect(ids).toEqual(['fk2', 'fk3']);
	});

	it('ON CONFLICT DO NOTHING und Rückgabespalte', async () => {
		const r = await insertRows(
			getDb(),
			T('parents'),
			[
				{ id: 'p1', name: 'anders' },
				{ id: 'p2', name: 'Neu' }
			],
			{ returnColumn: 'id' }
		);
		expect(r).toEqual({ inserted: 1, skipped: 1, returned: ['p2'] });
		const [p1] = await rows(`SELECT name FROM bk_test.parents WHERE id = 'p1'`);
		expect(p1!.name).toBe('Eltern');
	});

	it('zusätzlicher Filter und Quellspalten', async () => {
		const r = await insertRows(
			getDb(),
			T('parents'),
			[
				{ id: 'w1', name: 'ja', fremd: 1 },
				{ id: 'w2', name: 'nein', fremd: 2 }
			],
			{ where: `x.name = 'ja'`, sourceColumns: ['id', 'name', 'fremd'] }
		);
		expect(r).toEqual({ inserted: 1, skipped: 1, returned: [] });
	});

	it('Eigenbezug: Eltern im selben Batch, Waisen werden übersprungen', async () => {
		const t = T('nodes');
		const input = [
			{ id: 'c2', parent_id: 'c1', name: 'Enkel' },
			{ id: 'c1', parent_id: 'root', name: 'Kind' },
			{ id: 'root', parent_id: null, name: 'Wurzel' },
			{ id: 'orphan', parent_id: 'weg', name: 'Waise' },
			{ id: 'c3', parent_id: 'orphan', name: 'Kind der Waise' }
		];
		const sorted = sortRowsSelfRef(input, t);
		const r = await insertRows(getDb(), t, sorted, { returnColumn: 'name' });
		expect(r.inserted).toBe(3);
		expect(r.skipped).toBe(2);
		expect(r.returned.sort()).toEqual(['Enkel', 'Kind', 'Wurzel']);
		// zweiter Durchlauf: alles Konflikte, kein Fehler
		const again = await insertRows(getDb(), t, sorted);
		expect(again.inserted).toBe(0);
		// über Batch-Grenzen: Eltern schon in der Tabelle
		const r2 = await insertRows(getDb(), t, [{ id: 'c4', parent_id: 'c2', name: 'x' }]);
		expect(r2.inserted).toBe(1);
	});

	it('ungültige Bezeichner werden abgelehnt', async () => {
		const bad: TableInfo = { ...T('parents'), table: 'x"; DROP TABLE y; --' };
		await expect(insertRows(getDb(), bad, [{ id: 'a' }])).rejects.toThrow(/Bezeichner/);
	});
});
