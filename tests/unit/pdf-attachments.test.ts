import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { ctxWith, settingsStore } from './_helpers';

vi.mock('$lib/server/core/settings/service', () => ({
	getSettings: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settingsStore[k]])),
	getSetting: async (k: string) => settingsStore[k]
}));
vi.mock('$lib/server/core/storage', () => ({
	upload: vi.fn(),
	readFileByIdUnchecked: async () => null
}));

import * as pdf from '$lib/server/core/pdf';
import { getTemplate, renderBlocks } from '$lib/server/core/pdf/templates';
import type { PdfBlock } from '$lib/sdk/types';

async function makePdf(pages: number): Promise<Uint8Array> {
	const d = await PDFDocument.create();
	for (let i = 0; i < pages; i++) d.addPage([300, 400]);
	return d.save();
}

const PNG_1X1 = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	)
);

let htmls: string[] = [];

beforeEach(() => {
	htmls = [];
	Object.assign(settingsStore, {
		'core.organization.name': 'Verein',
		'core.organization.address': '',
		'core.organization.email': '',
		'core.organization.phone': '',
		'core.design.logoFileId': '',
		'core.design.accentColor': '#112233',
		'core.pdf.defaultFormat': 'A4',
		'core.pdf.defaultOrientation': 'portrait',
		'core.pdf.marginTop': '25mm',
		'core.pdf.marginRight': '18mm',
		'core.pdf.marginBottom': '22mm',
		'core.pdf.marginLeft': '18mm',
		'core.pdf.headerText': '',
		'core.pdf.footerText': '',
		'core.pdf.showLogo': false
	});
	// Hauptdokument: 2 Seiten; Anlagenseiten: je Abschnitt (`<section`) eine Seite
	pdf.setPdfRendererForTests(async (html) => {
		htmls.push(html);
		const sections = (html.match(/<section/g) ?? []).length;
		return makePdf(sections > 0 ? sections : 2);
	});
});
afterEach(() => pdf.setPdfRendererForTests(undefined));

async function count(bytes: Uint8Array): Promise<number> {
	return (await PDFDocument.load(bytes)).getPageCount();
}

describe('Gitter-Tabelle', () => {
	it('rendert Rahmen, Kopfzeile, Summenzeile und Ausrichtung', () => {
		const html = renderBlocks([
			{
				type: 'table',
				variant: 'grid',
				columns: ['Posten', 'Betrag'],
				rows: [['<b>Zelt</b>', '10,00']],
				caption: { left: 'Einnahmen', right: '10,00 EUR' },
				align: ['left', 'right'],
				widths: [3, 1],
				totalRow: ['Summe', '10,00']
			}
		]);
		expect(html).toContain('border-collapse:collapse');
		expect(html).toContain('table-layout:fixed');
		expect(html).toContain('1px solid #000');
		expect(html).toContain('colspan="1"');
		expect(html).toContain('Einnahmen');
		expect(html).toContain('10,00 EUR');
		expect(html).toContain('text-align:right');
		expect(html).toContain('width:75.000%');
		expect(html).toContain('border-top:1px solid #000');
		expect(html).toContain('box-shadow:0 0 0 0.5px #000');
		expect(html).toContain('break-inside:avoid');
		expect(html).toContain('&lt;b&gt;Zelt&lt;/b&gt;');
		expect(html).not.toContain('<b>Zelt');
	});

	it('ignoriert ungültige align- und widths-Werte', () => {
		const html = renderBlocks([
			{
				type: 'table',
				variant: 'grid',
				columns: ['A', 'B'],
				rows: [['1', '2']],
				align: ['evil;x:y' as 'left', 'right'],
				widths: [1, -2]
			}
		]);
		expect(html).not.toContain('evil');
		expect(html).not.toContain('<colgroup>');
		expect(html).toContain('text-align:left');
	});

	it('bricht lange Wörter (Dateinamen, IBAN) in der Zelle um', () => {
		const html = renderBlocks([
			{
				type: 'table',
				variant: 'grid',
				columns: ['Datei'],
				rows: [['Umsatzdetails__DE56672300004480838069_15-10-2026_17-10-2.pdf']]
			}
		]);
		expect(html).toContain('overflow-wrap:anywhere');
	});

	it('rendert Tabellen ohne variant ohne Gitter (kurze Tabellen zusammenhalten)', () => {
		const html = renderBlocks([{ type: 'table', columns: ['A'], rows: [['1']] }]);
		expect(html).toBe(
			'<table class="keep"><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>'
		);
		const long = renderBlocks([
			{ type: 'table', columns: ['A'], rows: Array.from({ length: 13 }, (_, i) => [String(i)]) }
		]);
		expect(long.startsWith('<table><thead>')).toBe(true);
	});
});

describe('Seitenumbruch-Regeln', () => {
	const grid = (rows: number, extra: object = {}): PdfBlock =>
		({
			type: 'table',
			variant: 'grid',
			columns: ['A', 'B'],
			rows: Array.from({ length: rows }, (_, i) => [String(i), 'x']),
			...extra
		}) as PdfBlock;

	it('kurze Gitter-Tabellen stehen in einem Wrapper mit break-inside:avoid, lange nicht', () => {
		const short = renderBlocks([grid(12)]);
		expect(short).toMatch(/^<div class="grid-table" style="[^"]*break-inside:avoid;/);
		const long = renderBlocks([grid(13)]);
		expect(long).toMatch(/^<div class="grid-table"/);
		expect(long).not.toMatch(/^<div class="grid-table" style="[^"]*break-inside:avoid/);
		expect(long).toContain('<thead style="display:table-header-group;">');
	});

	it('Summenzeile hängt an der letzten Datenzeile (kein Umbruch davor)', () => {
		const html = renderBlocks([grid(3, { totalRow: ['Summe', '1'] })]);
		expect(html).toContain('break-before:avoid');
		expect(html.match(/break-after:avoid/g)?.length).toBeGreaterThanOrEqual(1);
		const lastBody = html.split('<tbody>')[1]!.split('</tr>')[2]!;
		expect(lastBody).toContain('break-after:avoid');
	});

	it('Kopf- und Beschriftungszeile bleiben mit der ersten Datenzeile zusammen', () => {
		const html = renderBlocks([grid(2, { caption: { left: 'Titel', right: '1' } })]);
		const head = html.split('<thead')[1]!.split('</thead>')[0]!;
		expect(head.match(/break-after:avoid/g)).toHaveLength(2);
	});

	it('Absatz vor einer Tabelle bleibt mit ihr zusammen, vor Absatz nicht', () => {
		const withTable = renderBlocks([{ type: 'paragraph', text: 'Intro' }, grid(1)]);
		expect(withTable.startsWith('<p style="break-after:avoid;">Intro</p>')).toBe(true);
		const plain = renderBlocks([
			{ type: 'paragraph', text: 'A' },
			{ type: 'paragraph', text: 'B' }
		]);
		expect(plain).toBe('<p>A</p>\n<p>B</p>');
	});

	it('Summentabelle ohne Zeilen: keine leere Kopfzeile, eng an die Tabelle davor gekoppelt', () => {
		const html = renderBlocks([
			grid(2, { caption: { left: 'Gruppe' } }),
			{
				type: 'table',
				variant: 'grid',
				columns: ['Bezeichnung', 'Betrag'],
				rows: [],
				totalRow: ['Summe', '3']
			}
		]);
		const [first, second] = html.split('\n') as [string, string];
		expect(first).toContain('break-after:avoid');
		expect(second).not.toContain('Bezeichnung');
		expect(second).toContain('margin:0 0 16px');
	});

	it('pageBreak: kein Umbruch am Anfang/Ende, aufeinanderfolgende nur einmal', () => {
		const html = renderBlocks([
			{ type: 'pageBreak' },
			{ type: 'paragraph', text: 'A' },
			{ type: 'pageBreak' },
			{ type: 'pageBreak' },
			{ type: 'paragraph', text: 'B' },
			{ type: 'pageBreak' }
		]);
		expect(html.match(/break-before:page/g)).toHaveLength(1);
		expect(html).not.toContain('break-after:page');
		expect(html.indexOf('break-before:page')).toBeGreaterThan(html.indexOf('A</p>'));
		expect(html.indexOf('break-before:page')).toBeLessThan(html.indexOf('B</p>'));
	});

	it('Überschriften brechen nie direkt nach sich selbst um', () => {
		const t = getTemplate('default')!;
		const css = t.css({
			title: 'T',
			organization: { name: '', address: '', email: '', phone: '' },
			logoDataUrl: null,
			headerText: '',
			footerText: '',
			accentColor: '#2563eb',
			createdAt: new Date(),
			locale: 'de-DE'
		});
		expect(css).toMatch(/h1, h2, h3 {[^}]*break-after: avoid/);
	});
});

describe('Anlagen', () => {
	it('hängt Bild- und PDF-Anlagen in Reihenfolge an (Seitenzahl)', async () => {
		const res = await pdf.generate(ctxWith(), {
			title: 'Bericht',
			content: [],
			attachments: [
				{ label: 'Beleg 1', caption: 'Zelt', contentType: 'image/png', data: PNG_1X1 },
				{ label: 'Beleg 2', contentType: 'application/pdf', data: await makePdf(3) },
				{ label: 'Beleg 3', contentType: 'image/png', data: PNG_1X1 }
			]
		});
		// 2 (Haupt) + 2 Bildseiten + 3 PDF-Seiten
		expect(await count(res.buffer)).toBe(7);
		const attachHtml = htmls[1]!;
		expect(attachHtml).toContain('Beleg 1');
		expect(attachHtml).toContain('data:image/png;base64,');
		expect(attachHtml).toContain('img-src data:');
	});

	it('ersetzt defekte und unbekannte Anlagen durch Platzhalterseiten', async () => {
		const res = await pdf.generate(ctxWith(), {
			title: 'Bericht',
			content: [],
			attachments: [
				{ label: 'Kaputt', contentType: 'application/pdf', data: new Uint8Array([1, 2, 3]) },
				{ label: 'Text', contentType: 'text/plain', data: new Uint8Array([65]) }
			]
		});
		expect(await count(res.buffer)).toBe(4);
		expect(htmls[1]).toContain('Anlage nicht lesbar');
	});

	it('escaped Label und Caption', async () => {
		await pdf.generate(ctxWith(), {
			title: 'T',
			content: [],
			attachments: [
				{ label: '<i>x</i>', caption: '<u>y</u>', contentType: 'image/png', data: PNG_1X1 }
			]
		});
		expect(htmls[1]).not.toContain('<i>x');
		expect(htmls[1]).toContain('&lt;u&gt;y&lt;/u&gt;');
	});

	it('begrenzt Anzahl und Größe', async () => {
		const many = Array.from({ length: 81 }, () => ({
			label: 'x',
			contentType: 'image/png',
			data: PNG_1X1
		}));
		await expect(
			pdf.generate(ctxWith(), { title: 'T', content: [], attachments: many })
		).rejects.toMatchObject({ code: 'bad_request' });
		const big = new Uint8Array(61 * 1024 * 1024);
		await expect(
			pdf.generate(ctxWith(), {
				title: 'T',
				content: [],
				attachments: [{ label: 'x', contentType: 'application/pdf', data: big }]
			})
		).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('meldet unavailable, wenn das Hauptdokument nicht ladbar ist', async () => {
		pdf.setPdfRendererForTests(async () => new Uint8Array([0x25, 0x50, 0x44]));
		await expect(
			pdf.generate(ctxWith(), {
				title: 'T',
				content: [],
				attachments: [{ label: 'x', contentType: 'application/pdf', data: await makePdf(1) }]
			})
		).rejects.toMatchObject({ code: 'unavailable' });
	});
});
