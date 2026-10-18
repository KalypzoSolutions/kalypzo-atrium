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
import type { RenderOptions } from '$lib/server/core/pdf';
import type { PdfAttachment } from '$lib/sdk/types';

const PNG_1X1 = Uint8Array.from(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
		'base64'
	)
);

async function makePdf(pages: number, size: [number, number] = [300, 400]): Promise<Uint8Array> {
	const d = await PDFDocument.create();
	for (let i = 0; i < pages; i++) d.addPage(size);
	return d.save();
}

const img = (label: string): PdfAttachment => ({ label, contentType: 'image/png', data: PNG_1X1 });

let calls: { html: string; options: RenderOptions }[] = [];
/** Seiten je Abschnitt, die der Test-Renderer fuer Anlagen-Durchgaenge erzeugt. */
let pagesPerSection = 1;

beforeEach(() => {
	calls = [];
	pagesPerSection = 1;
	Object.assign(settingsStore, {
		'core.organization.name': 'Stamm',
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
	// Hauptdokument: 1 Seite (100 x 100); Anlagen: pagesPerSection Seiten (300 x 400) je `<section`
	pdf.setPdfRendererForTests(async (html, options) => {
		calls.push({ html, options });
		const sections = (html.match(/<section/g) ?? []).length;
		return sections > 0 ? makePdf(sections * pagesPerSection) : makePdf(1, [100, 100]);
	});
});
afterEach(() => pdf.setPdfRendererForTests(undefined));

async function load(bytes: Uint8Array): Promise<PDFDocument> {
	return PDFDocument.load(bytes);
}

describe('Bild-Anlagen und Ausrichtung', () => {
	it('Quer-Vorlage: Bild auf 145mm begrenzt, Anlagen quer gerendert', async () => {
		const res = await pdf.generate(ctxWith(), {
			title: 'Quer',
			content: [],
			template: 'stamm-briefkopf-quer',
			attachments: [img('Beleg 1')]
		});
		expect(calls).toHaveLength(2);
		const att = calls[1]!;
		expect(att.options.landscape).toBe(true);
		expect(att.html).toContain('max-height:145mm');
		expect(att.html).not.toContain('max-height:215mm');
		expect((await load(res.buffer)).getPageCount()).toBe(2);
	});

	it('Hochkant-Vorlage: Bild weiter auf 215mm begrenzt', async () => {
		await pdf.generate(ctxWith(), {
			title: 'Hoch',
			content: [],
			template: 'stamm-briefkopf',
			attachments: [img('Beleg 1')]
		});
		const att = calls[1]!;
		expect(att.options.landscape).toBe(false);
		expect(att.html).toContain('max-height:215mm');
		expect(att.html).not.toContain('max-height:145mm');
	});

	it('Ueberlauf: jede Anlage einzeln gerendert, alle Seiten in richtiger Reihenfolge', async () => {
		pagesPerSection = 2;
		const res = await pdf.generate(ctxWith(), {
			title: 'Quer',
			content: [],
			template: 'stamm-briefkopf-quer',
			attachments: [
				img('A'),
				{ label: 'P', contentType: 'application/pdf', data: await makePdf(1, [200, 200]) },
				img('B')
			]
		});
		// Haupt + gemeinsamer Durchgang (4 statt 2 Seiten) + je Bild ein Einzeldurchgang
		expect(calls).toHaveLength(4);
		expect(calls[2]!.html).toContain('A</div>');
		expect(calls[2]!.html).not.toContain('B</div>');
		expect(calls[2]!.html).not.toContain('break-before:page');
		expect(calls[3]!.html).toContain('B</div>');
		expect(calls.slice(1).every((c) => c.options.landscape)).toBe(true);
		const doc = await load(res.buffer);
		// Haupt (1) + A (2) + PDF (1) + B (2)
		const widths = doc.getPages().map((p) => p.getSize().width);
		expect(widths).toEqual([100, 300, 300, 200, 300, 300]);
	});

	it('kein Ueberlauf: ein einziger Anlagen-Durchgang', async () => {
		const res = await pdf.generate(ctxWith(), {
			title: 'Quer',
			content: [],
			template: 'stamm-briefkopf-quer',
			attachments: [img('A'), img('B')]
		});
		expect(calls).toHaveLength(2);
		expect((await load(res.buffer)).getPageCount()).toBe(3);
	});
});
