import { describe, expect, it } from 'vitest';
import {
	planInsertOrder,
	selfReference,
	sortRowsSelfRef,
	sortTablesForInsert
} from '$lib/server/core/backup/introspect';
import type { ForeignKeyInfo, TableInfo } from '$lib/server/core/backup/types';

function t(table: string, refs: string[] = [], schema = 'public'): TableInfo {
	return {
		schema,
		table,
		columns: [{ name: 'id', type: 'text', nullable: false }],
		primaryKey: ['id'],
		foreignKeys: refs.map((r): ForeignKeyInfo => {
			const [s, n] = r.includes('.') ? r.split('.') : [schema, r];
			return { columns: [`${n}_id`], refSchema: s!, refTable: n!, refColumns: ['id'] };
		})
	};
}

const names = (list: TableInfo[]) => list.map((x) => `${x.schema}.${x.table}`);

describe('sortTablesForInsert', () => {
	it('stellt FK-Eltern vor Kinder', () => {
		const out = sortTablesForInsert([
			t('account', ['user']),
			t('user_role', ['user', 'role']),
			t('role'),
			t('user')
		]);
		expect(names(out)).toEqual([
			'public.role',
			'public.user',
			'public.account',
			'public.user_role'
		]);
	});

	it('behält die Eingabereihenfolge bei gleichrangigen Tabellen', () => {
		expect(names(sortTablesForInsert([t('c'), t('a'), t('b')]))).toEqual([
			'public.c',
			'public.a',
			'public.b'
		]);
	});

	it('ignoriert Kanten zu Tabellen außerhalb der Menge und Eigenbezug', () => {
		const out = sortTablesForInsert([
			t('nodes', ['nodes', 'owners']),
			t('x', ['public.user'], 'mod_a')
		]);
		expect(names(out)).toEqual(['public.nodes', 'mod_a.x']);
	});

	it('unterscheidet Schemas', () => {
		const out = sortTablesForInsert([
			t('items', ['groups'], 'mod_a'),
			t('groups', [], 'mod_b'),
			t('groups', [], 'mod_a')
		]);
		expect(names(out)).toEqual(['mod_b.groups', 'mod_a.groups', 'mod_a.items']);
	});

	it('entfernt doppelte Einträge', () => {
		expect(names(sortTablesForInsert([t('setting'), t('setting')]))).toEqual(['public.setting']);
	});

	it('meldet Zyklen mit Tabellennamen', () => {
		expect(() => sortTablesForInsert([t('ok'), t('a', ['b']), t('b', ['a'])])).toThrow(
			/public\.a, public\.b/
		);
	});
});

describe('planInsertOrder', () => {
	/** Tabelle mit FK-Spalten `<ref>_id`, nullbar laut `nullable` */
	function tn(table: string, refs: string[], nullable: string[] = []): TableInfo {
		const base = t(table, refs);
		return {
			...base,
			columns: [
				...base.columns,
				...refs.map((r) => ({ name: `${r}_id`, type: 'text', nullable: nullable.includes(r) }))
			]
		};
	}

	it('ohne Zyklus keine verzögerten Kanten', () => {
		const r = planInsertOrder([tn('b', ['a']), tn('a', [])]);
		expect(names(r.order)).toEqual(['public.a', 'public.b']);
		expect(r.deferred).toEqual([]);
	});

	it('bricht einen Zyklus an der nullbaren Kante (Titelbild)', () => {
		// galleries.images_id (nullbar) → images, images.galleries_id (NOT NULL) → galleries
		const r = planInsertOrder([
			tn('galleries', ['images'], ['images']),
			tn('images', ['galleries']),
			tn('shares', ['galleries'])
		]);
		expect(names(r.order)).toEqual(['public.galleries', 'public.images', 'public.shares']);
		expect(r.deferred).toHaveLength(1);
		expect(r.deferred[0]).toMatchObject({ schema: 'public', table: 'galleries' });
		expect(r.deferred[0]!.fk.columns).toEqual(['images_id']);
	});

	it('wählt die nullbare Kante auch, wenn sie beim Kind liegt', () => {
		const r = planInsertOrder([tn('a', ['b']), tn('b', ['a'], ['a'])]);
		expect(names(r.order)).toEqual(['public.b', 'public.a']);
		expect(r.deferred.map((d) => d.table)).toEqual(['b']);
	});

	it('Zyklus ohne nullbare Kante → Fehler', () => {
		expect(() => planInsertOrder([tn('a', ['b']), tn('b', ['a'])])).toThrow(
			/Zyklische Fremdschlüssel zwischen Tabellen: public\.a, public\.b/
		);
	});

	it('mehrere Zyklen: je Zyklus eine Kante', () => {
		const r = planInsertOrder([
			tn('a', ['b'], ['b']),
			tn('b', ['a']),
			tn('c', ['d'], ['d']),
			tn('d', ['c'])
		]);
		expect(r.deferred.map((d) => d.table)).toEqual(['a', 'c']);
		expect(r.order).toHaveLength(4);
	});
});

describe('selfReference', () => {
	it('findet den Eigenbezug', () => {
		const nodes = t('nodes', ['nodes', 'owners'], 'mod_files');
		expect(selfReference(nodes)?.columns).toEqual(['nodes_id']);
		expect(selfReference(t('user'))).toBeNull();
	});
});

describe('sortRowsSelfRef', () => {
	const nodes: TableInfo = {
		schema: 'mod_files',
		table: 'nodes',
		columns: [
			{ name: 'id', type: 'text', nullable: false },
			{ name: 'parent_id', type: 'text', nullable: true }
		],
		primaryKey: ['id'],
		foreignKeys: [
			{ columns: ['parent_id'], refSchema: 'mod_files', refTable: 'nodes', refColumns: ['id'] }
		]
	};
	const ids = (rows: Record<string, unknown>[]) => rows.map((r) => r.id);

	it('stellt Eltern vor Kinder (auch tief verschachtelt)', () => {
		const rows = [
			{ id: 'c', parent_id: 'b' },
			{ id: 'b', parent_id: 'a' },
			{ id: 'a', parent_id: null },
			{ id: 'd', parent_id: 'a' },
			{ id: 'e', parent_id: null }
		];
		const out = sortRowsSelfRef(rows, nodes);
		expect(ids(out)).toEqual(['a', 'b', 'd', 'c', 'e']);
		for (const r of out) {
			if (r.parent_id) {
				expect(ids(out).indexOf(r.parent_id)).toBeLessThan(ids(out).indexOf(r.id));
			}
		}
	});

	it('hängt verwaiste Zeilen samt Nachkommen ans Ende (Eltern vor Kindern)', () => {
		const rows = [
			{ id: 'k', parent_id: 'o' },
			{ id: 'o', parent_id: 'fehlt' },
			{ id: 'r', parent_id: null }
		];
		expect(ids(sortRowsSelfRef(rows, nodes))).toEqual(['r', 'o', 'k']);
	});

	it('verliert bei Zyklen und Selbstverweisen keine Zeile', () => {
		const rows = [
			{ id: 'x', parent_id: 'y' },
			{ id: 'y', parent_id: 'x' },
			{ id: 's', parent_id: 's' }
		];
		expect(ids(sortRowsSelfRef(rows, nodes))).toEqual(['s', 'x', 'y']);
	});

	it('lässt Tabellen ohne Eigenbezug unverändert', () => {
		const rows = [{ id: 'b' }, { id: 'a' }];
		expect(sortRowsSelfRef(rows, t('user'))).toBe(rows);
	});

	it('unterstützt zusammengesetzte Schlüssel', () => {
		const comp: TableInfo = {
			...nodes,
			foreignKeys: [
				{
					columns: ['p_ns', 'p_id'],
					refSchema: 'mod_files',
					refTable: 'nodes',
					refColumns: ['ns', 'id']
				}
			]
		};
		const rows = [
			{ ns: 1, id: 'b', p_ns: 1, p_id: 'a' },
			{ ns: 1, id: 'a', p_ns: null, p_id: null }
		];
		expect(ids(sortRowsSelfRef(rows, comp))).toEqual(['a', 'b']);
	});
});
