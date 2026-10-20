import { describe, expect, it } from 'vitest';
import {
	CUSTOM_PRESET_ID,
	LIST_MAX_COLUMNS,
	LIST_PAGE_WIDTH_MM,
	LIST_PRESET_KEYS,
	buildListBlocks,
	buildSectionedListBlocks,
	columnWidthsMm,
	estimatePages,
	normalizeSelection,
	presetColumns,
	selectionHasSensitive,
	selectedColumns,
	visibleColumns,
	type ListColumn,
	type ListPreset
} from '../../src/lib/pdf-lists';

const col = (key: string, extra: Partial<ListColumn> = {}): ListColumn => ({
	key,
	label: key.toUpperCase(),
	group: 'person',
	weight: 1,
	...extra
});
const catalog: ListColumn[] = [
	col('name', { weight: 3 }),
	col('groups', { weight: 2 }),
	col('age', { weight: 1, align: 'right' }),
	col('emergencyPhone', { group: 'contact', weight: 2 }),
	col('phone', { group: 'contact' }),
	col('email', { group: 'contact', weight: 3 }),
	col('field.ernaehrung', { group: 'health', sensitive: true }),
	col('field.allergien', { group: 'health', sensitive: true, weight: 3 }),
	col('field.medikamente', { group: 'health', sensitive: true, weight: 3 })
];
const presets: ListPreset[] = [
	{ id: 'fahrt', label: 'Fahrt', keys: [...LIST_PRESET_KEYS.fahrt] },
	{ id: 'kontakt', label: 'Kontakt', keys: [...LIST_PRESET_KEYS.kontakt] },
	{ id: 'minimal', label: 'Minimal', keys: [...LIST_PRESET_KEYS.minimal] }
];

describe('normalizeSelection', () => {
	it('ohne Auswahl → Voreinstellung „fahrt“ in Katalogreihenfolge, leere Spalten ausblenden', () => {
		const s = normalizeSelection(undefined, catalog, presets);
		expect(s).toEqual({
			preset: 'fahrt',
			columns: [
				'name',
				'groups',
				'age',
				'emergencyPhone',
				'field.ernaehrung',
				'field.allergien',
				'field.medikamente'
			],
			hideEmpty: true
		});
	});

	it('nutzt die gewünschte Voreinstellung; unbekannte → fahrt', () => {
		expect(normalizeSelection({ preset: 'kontakt' }, catalog, presets).columns).toEqual([
			'name',
			'groups',
			'phone',
			'email'
		]);
		expect(normalizeSelection({ preset: 'gibt-es-nicht' }, catalog, presets).preset).toBe('fahrt');
	});

	it('verwirft unbekannte/doppelte Schlüssel, setzt `name` vorn, sortiert nach Katalog', () => {
		const s = normalizeSelection(
			{ columns: ['email', 'xyz', 'age', 'email'], hideEmpty: false },
			catalog,
			presets
		);
		expect(s.columns).toEqual(['name', 'age', 'email']);
		expect(s.preset).toBe(CUSTOM_PRESET_ID);
		expect(s.hideEmpty).toBe(false);
	});

	it('erkennt, wenn die Spalten genau einer Voreinstellung entsprechen', () => {
		const s = normalizeSelection({ columns: ['age', 'groups', 'name'] }, catalog, presets);
		expect(s.preset).toBe('minimal');
	});

	it('nur unbekannte Spalten → Voreinstellung; Obergrenze greift', () => {
		expect(normalizeSelection({ columns: ['x'] }, catalog, presets).preset).toBe('fahrt');
		const big = Array.from({ length: LIST_MAX_COLUMNS + 10 }, (_, i) => col(`c${i}`));
		const s = normalizeSelection({ columns: big.map((c) => c.key) }, [col('name'), ...big], []);
		expect(s.columns).toHaveLength(LIST_MAX_COLUMNS);
		expect(s.columns[0]).toBe('name');
	});

	it('leere Auswahl wird nie leer, solange der Katalog Spalten hat', () => {
		expect(normalizeSelection({ columns: [] }, [col('a')], []).columns).toEqual(['a']);
		expect(normalizeSelection(undefined, [], []).columns).toEqual([]);
	});
});

describe('presetColumns / selectedColumns', () => {
	it('Voreinstellung wird gegen den Katalog normalisiert', () => {
		const small = [col('name'), col('age')];
		expect(presetColumns(presets[0]!, small)).toEqual(['name', 'age']);
		expect(selectedColumns({ columns: ['age', 'zzz', 'name'] }, small).map((c) => c.key)).toEqual([
			'age',
			'name'
		]);
	});
});

describe('visibleColumns', () => {
	const rows = [
		{ name: 'A', groups: '', age: '9' },
		{ name: 'B', groups: '  ', age: '' }
	];
	const cols = catalog.slice(0, 3);
	it('blendet leere Spalten aus, `name` bleibt', () => {
		expect(visibleColumns(cols, rows, true).map((c) => c.key)).toEqual(['name', 'age']);
		expect(visibleColumns(cols, [], true).map((c) => c.key)).toEqual(['name']);
	});
	it('ohne hideEmpty bleibt alles', () => {
		expect(visibleColumns(cols, rows, false)).toHaveLength(3);
	});
});

describe('selectionHasSensitive', () => {
	it('erkennt Gesundheitsspalten', () => {
		expect(selectionHasSensitive({ columns: ['name', 'age'] }, catalog)).toBe(false);
		expect(selectionHasSensitive({ columns: ['name', 'field.allergien'] }, catalog)).toBe(true);
	});
});

describe('Layout', () => {
	it('Breiten: Summe = Seitenbreite, proportional, ungültige Gewichte zählen 1', () => {
		const w = columnWidthsMm([{ weight: 3 }, { weight: 1 }]);
		// 247 × 3/4 = 185,25 → 185,3 · 247 × 1/4 = 61,75 → 61,8
		expect(w).toEqual([185.3, 61.8]);
		expect(w[0]! + w[1]!).toBeCloseTo(LIST_PAGE_WIDTH_MM, 0);
		expect(columnWidthsMm([{ weight: 0 }, { weight: NaN }])).toEqual([123.5, 123.5]);
		expect(columnWidthsMm([])).toEqual([]);
	});

	it('eine Gitter-Tabelle mit Kopf, Ausrichtung, Breiten; fehlende Werte leer; Stand deutsch', () => {
		const cols = catalog.slice(0, 3);
		const blocks = buildListBlocks({
			title: 'Gruppe Adler',
			subtitle: 'Sippe',
			columns: cols,
			rows: [{ name: 'Anna', groups: 'Adler', age: '12' }, { name: 'Ben' }],
			generatedOn: '2026-10-17'
		});
		expect(blocks[0]).toEqual({ type: 'heading', level: 2, text: 'Gruppe Adler' });
		expect(blocks[1]).toEqual({
			type: 'paragraph',
			text: 'Sippe · 2 Personen · Stand 17.10.2026'
		});
		expect(blocks[2]).toMatchObject({
			type: 'table',
			variant: 'grid',
			columns: ['NAME', 'GROUPS', 'AGE'],
			align: ['left', 'left', 'right'],
			rows: [
				['Anna', 'Adler', '12'],
				['Ben', '', '']
			]
		});
		expect(blocks).toHaveLength(3);
	});

	it('Vertraulich-Hinweis nur auf Wunsch; keine Zeilen → „Keine Personen.“; Singular', () => {
		const withNote = buildListBlocks({
			title: 'T',
			columns: catalog.slice(0, 1),
			rows: [],
			generatedOn: '2026-10-17',
			confidential: true
		});
		expect((withNote[1] as { text: string }).text).toContain('Vertraulich');
		expect(withNote[2]).toEqual({ type: 'paragraph', text: 'Keine Personen.' });
		const one = buildListBlocks({
			title: 'T',
			columns: catalog.slice(0, 1),
			rows: [{ name: 'A' }],
			generatedOn: '2026-10-17'
		});
		expect((one[1] as { text: string }).text).toContain('1 Person ·');
		expect((one[1] as { text: string }).text).not.toContain('Vertraulich');
	});

	it('Abschnitte: neue Seite ab dem zweiten, Umlaute bleiben', () => {
		const blocks = buildSectionedListBlocks(
			[
				{ title: 'Wölflinge', rows: [{ name: 'Jörg' }] },
				{ title: 'Späher', rows: [{ name: 'Zoë' }] }
			],
			{ columns: catalog.slice(0, 1), generatedOn: '2026-10-17' }
		);
		expect(blocks.map((b) => b.type)).toEqual([
			'heading',
			'paragraph',
			'table',
			'pageBreak',
			'heading',
			'paragraph',
			'table'
		]);
		expect(JSON.stringify(blocks)).toContain('Jörg');
	});
});

describe('estimatePages', () => {
	it('Grenzwerte: 0 → 1, genau eine Seite, Seitengrenze, ungültige Zahlen', () => {
		const few = catalog.slice(0, 4);
		expect(estimatePages(0, few)).toBe(1);
		expect(estimatePages(20, few)).toBe(1);
		expect(estimatePages(21, few)).toBe(2);
		expect(estimatePages(-5, few)).toBe(1);
		expect(estimatePages(Number.NaN, few)).toBe(1);
	});
	it('mehr Spalten → mehr Seiten; Abschnitte zählen je mindestens eine Seite', () => {
		expect(estimatePages(40, catalog)).toBeGreaterThan(estimatePages(40, catalog.slice(0, 3)));
		expect(estimatePages(3, catalog.slice(0, 3), 4)).toBe(4);
	});
});
