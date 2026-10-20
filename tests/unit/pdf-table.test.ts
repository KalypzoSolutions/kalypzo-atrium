import { describe, expect, it } from 'vitest';
import type { PdfBlock } from '$lib/sdk/types';
import { placeRows, renderBlocks } from '$lib/server/core/pdf/templates';

type Table = Extract<PdfBlock, { type: 'table' }>;
const grid = (t: Partial<Table> & Pick<Table, 'columns' | 'rows'>): string =>
	renderBlocks([{ type: 'table', variant: 'grid', ...t }]);

/** Kurzform zum Prüfen: (Spalte, Spannweite, Zeilenspanne, Text) je Zelle */
const shape = (rows: ReturnType<typeof placeRows>) =>
	rows.map((r) => r.map((c) => [c.col, c.colspan, c.rowspan, c.text]));

describe('placeRows (Zellen zusammenfassen)', () => {
	it('einfache Texte ergeben je eine Zelle pro Spalte', () => {
		expect(shape(placeRows([['a', 'b', 'c']], 3))).toEqual([
			[
				[0, 1, 1, 'a'],
				[1, 1, 1, 'b'],
				[2, 1, 1, 'c']
			]
		]);
	});

	it('colspan fasst Spalten zusammen, der Rest rückt nach', () => {
		expect(shape(placeRows([[{ text: 'Summe', colspan: 2 }, '5,00 €']], 3))).toEqual([
			[
				[0, 2, 1, 'Summe'],
				[2, 1, 1, '5,00 €']
			]
		]);
	});

	it('colspan wird auf die Tabellenbreite geklemmt, ungültige Werte werden 1', () => {
		const p = placeRows(
			[
				[{ text: 'x', colspan: 99 }],
				[
					{ text: 'y', colspan: 0 },
					{ text: 'z', colspan: -3 },
					{ text: 'w', colspan: NaN }
				],
				[{ text: 'v', colspan: 1.9 }]
			],
			3
		);
		expect(p[0]![0]!.colspan).toBe(3);
		expect(p[1]!.map((c) => c.colspan)).toEqual([1, 1, 1]);
		expect(p[2]![0]!.colspan).toBe(1);
	});

	it('rowspan belegt die Spalte in den Folgezeilen, diese Zeilen überspringen sie', () => {
		const p = placeRows(
			[
				[{ text: 'Gruppe', rowspan: 2 }, 'a1', 'a2'],
				['b1', 'b2'],
				['c0', 'c1', 'c2']
			],
			3
		);
		expect(shape(p)).toEqual([
			[
				[0, 1, 2, 'Gruppe'],
				[1, 1, 1, 'a1'],
				[2, 1, 1, 'a2']
			],
			[
				[1, 1, 1, 'b1'],
				[2, 1, 1, 'b2']
			],
			[
				[0, 1, 1, 'c0'],
				[1, 1, 1, 'c1'],
				[2, 1, 1, 'c2']
			]
		]);
	});

	it('rowspan reicht nicht über die letzte Zeile des Abschnitts hinaus', () => {
		const p = placeRows([[{ text: 'a', rowspan: 5 }, 'b'], ['c']], 2);
		expect(p[0]![0]!.rowspan).toBe(2);
		expect(placeRows([[{ text: 'Summe', rowspan: 3 }, 'x']], 2)[0]![0]!.rowspan).toBe(1);
	});

	it('colspan stößt nicht in eine von oben belegte Spalte', () => {
		const p = placeRows(
			[['a', { text: 'mitte', rowspan: 2 }, 'c'], [{ text: 'breit', colspan: 3 }]],
			3
		);
		// Zeile 2: Spalte 0 frei, Spalte 1 belegt -> colspan wird auf 1 gekürzt, Spalte 2 wird aufgefüllt
		expect(p[1]!.map((c) => [c.col, c.colspan, c.text])).toEqual([
			[0, 1, 'breit'],
			[2, 1, '']
		]);
	});

	it('fehlende Zellen am Zeilenende werden leer aufgefüllt, überzählige verworfen', () => {
		const p = placeRows([['a'], ['a', 'b', 'c', 'd', 'e']], 3);
		expect(p[0]!.map((c) => c.text)).toEqual(['a', '', '']);
		expect(p[1]!.map((c) => c.text)).toEqual(['a', 'b', 'c']);
	});

	it('Ausrichtung und Fett pro Zelle, ungültige Ausrichtung wird ignoriert', () => {
		const p = placeRows(
			[
				[
					{ text: 'a', align: 'right', bold: true },
					{ text: 'b', align: 'oben' as never }
				]
			],
			2
		);
		expect(p[0]![0]).toMatchObject({ align: 'right', bold: true });
		expect(p[0]![1]!.align).toBeUndefined();
	});

	it('ohne Spalten oder ohne Zeilen entsteht nichts (kein Absturz)', () => {
		expect(placeRows([], 3)).toEqual([]);
		expect(placeRows([['a']], 0)).toEqual([[]]);
	});
});

describe('Gitter-Tabelle: Darstellung', () => {
	it('colspan/rowspan stehen im HTML, Text bleibt escaped', () => {
		const html = grid({
			columns: ['A', 'B', 'C'],
			rows: [[{ text: '<b>Summe</b> & Co', colspan: 2 }, 'x']],
			totalRow: [{ text: 'Gesamt', colspan: 2 }, '1,00 €']
		});
		expect(html).toContain('colspan="2"');
		expect(html).toContain('&lt;b&gt;Summe&lt;/b&gt; &amp; Co');
		expect(html).not.toContain('<b>Summe');
	});

	it('Linien sind dünn: 0,5-px-Schatten statt dicker Rahmen, keine Doppellinie', () => {
		const html = grid({ columns: ['A', 'B'], rows: [['1', '2']], totalRow: ['Summe', '3'] });
		expect(html).toContain('box-shadow:0 0 0 0.5px #000');
		expect(html).not.toContain('3px double');
		expect(html).not.toContain('border:1px solid #000');
		// Summenzeile: eine einfache Linie darüber, fett
		expect(html).toMatch(/border-top:1px solid #000/);
		expect(html).toMatch(/font-weight:bold;border-top:1px solid #000/);
	});

	it('Zellausrichtung: Spaltenvorgabe, Zelle überschreibt, colspan nutzt die Startspalte', () => {
		const html = grid({
			columns: ['A', 'B', 'C'],
			align: ['left', 'right', 'right'],
			rows: [
				['l', 'r', { text: 'z', align: 'center' }],
				[{ text: 'x', colspan: 2 }, 'y']
			]
		});
		const cells = [...html.matchAll(/<td[^>]*text-align:(\w+);[^>]*>([^<]*)<\/td>/g)].map((m) => [
			m[2],
			m[1]
		]);
		expect(cells).toEqual([
			['l', 'left'],
			['r', 'right'],
			['z', 'center'],
			['x', 'left'],
			['y', 'right']
		]);
	});

	it('Spaltenbreiten und Kopfzeile bleiben, Zeilenumbruch im Text wird <br/>', () => {
		const html = grid({
			columns: ['A', 'B'],
			widths: [1, 3],
			rows: [['zwei\nZeilen', 'b']]
		});
		expect(html).toContain('width:25.000%');
		expect(html).toContain('width:75.000%');
		expect(html).toContain('zwei<br/>Zeilen');
		expect(html).toContain('<thead');
	});

	it('Summentabelle ohne Zeilen: Summenzeile mit colspan, keine leere Kopfzeile', () => {
		const html = grid({
			columns: ['A', 'B'],
			rows: [],
			totalRow: ['Summe Einnahmen', '800,00 €']
		});
		expect(html).toContain('Summe Einnahmen');
		expect(html).not.toMatch(/<th[ >]/);
	});
});

describe('Gitter-Tabelle: angehängte Summentabelle', () => {
	const margins = (html: string) =>
		[...html.matchAll(/class="grid-table" style="margin:([^;]+);/g)].map((m) => m[1]);
	const data: PdfBlock = {
		type: 'table',
		variant: 'grid',
		caption: { left: 'Teilnehmerbeiträge', right: '800,00 €' },
		columns: ['Datum', 'Bezeichnung', 'Betrag'],
		rows: [['01.05.2026', 'Beitrag', '800,00 €']]
	};
	const summary: PdfBlock = {
		type: 'table',
		variant: 'grid',
		columns: ['Bezeichnung', 'Betrag'],
		rows: [],
		totalRow: ['Summe Einnahmen', '800,00 €']
	};

	it('Nahtstelle ohne Abstand: Tabelle unten 0, Summentabelle oben 0 und unten 16px', () => {
		const html = renderBlocks([data, summary]);
		expect(margins(html)).toEqual(['16px 0 0', '0 0 16px']);
		// Tabellen-Rand aus baseCss (table { margin: 16px 0 }) darf nicht durch den Container kollabieren
		expect(html.match(/<table style="[^"]*margin:0;/g)).toHaveLength(2);
		// Seitenumbruch-Schutz an der Naht bleibt
		expect(html).toMatch(/margin:16px 0 0;[^"]*break-after:avoid;/);
		expect(html).toMatch(/margin:0 0 16px;[^"]*break-before:avoid;/);
		// Summenzeile: genau eine Linie darüber (Schatten + border-top), kein zusätzlicher Rahmen
		expect(html.match(/border-top:1px solid #000/g)).toHaveLength(2);
	});

	it('normale Tabellen behalten 16px oben und unten', () => {
		const html = renderBlocks([data, { type: 'paragraph', text: 'x' }, data]);
		expect(margins(html)).toEqual(['16px 0 16px', '16px 0 16px']);
		expect(html).not.toContain('break-before:avoid;"');
	});

	it('Summentabelle ohne Tabelle davor behält ihren Abstand', () => {
		const html = renderBlocks([{ type: 'paragraph', text: 'x' }, summary]);
		expect(margins(html)).toEqual(['16px 0 16px']);
	});

	it('Tabelle mit Beschriftung danach ist keine angehängte Summe', () => {
		const html = renderBlocks([data, data]);
		expect(margins(html)).toEqual(['16px 0 16px', '16px 0 16px']);
	});
});

describe('Standard-Tabelle (ohne grid)', () => {
	it('unterstützt ebenfalls zusammengefasste Zellen', () => {
		const html = renderBlocks([
			{
				type: 'table',
				columns: ['A', 'B', 'C'],
				rows: [
					[{ text: 'breit', colspan: 2, bold: true }, 'x'],
					['1', '2', '3']
				]
			}
		]);
		expect(html).toContain('<td colspan="2" style="font-weight:bold;">breit</td>');
		expect(html).toContain('<td>3</td>');
	});
});
