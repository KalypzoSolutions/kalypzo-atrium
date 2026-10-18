import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

let rendered: { html: string; options: RenderOptions } | undefined;
let previewHtml: string | undefined;
let previewSize: { width: number; height: number } | undefined;

const letter = {
	id: 'testbrief',
	label: 'Testbrief',
	css: () => 'body{color:#000}',
	header: () => '<i>h</i>',
	footer: () => '<i>f</i>',
	page: {
		format: 'A4' as const,
		margins: { top: '10mm', right: '20mm', bottom: '30mm', left: '40mm' }
	},
	overlay: (_d: unknown, i?: { recipient?: string[] }) =>
		`<div class="overlay">${(i?.recipient ?? []).map((l) => pdf.escapeHtml(l)).join('|')}</div>`,
	titleBlock: () => '<h1 class="tb">Titel</h1>',
	parts: [{ id: 'adressfeld', label: 'Adressfeld', x: 20, y: 50 }]
};

beforeEach(() => {
	rendered = undefined;
	previewHtml = undefined;
	previewSize = undefined;
	Object.assign(settingsStore, {
		'core.organization.name': 'Muster',
		'core.organization.address': '',
		'core.organization.email': '',
		'core.organization.phone': '',
		'core.design.logoFileId': '',
		'core.design.accentColor': '#112233',
		'core.pdf.defaultFormat': 'A3',
		'core.pdf.defaultOrientation': 'landscape',
		'core.pdf.marginTop': '25mm',
		'core.pdf.marginRight': '18mm',
		'core.pdf.marginBottom': '22mm',
		'core.pdf.marginLeft': '18mm',
		'core.pdf.headerText': '',
		'core.pdf.footerText': '',
		'core.pdf.showLogo': false
	});
	pdf.registerTemplate(letter);
	pdf.setPdfRendererForTests(async (html, options) => {
		rendered = { html, options };
		return new Uint8Array([1]);
	});
	pdf.setPreviewRendererForTests(async (html, size) => {
		previewHtml = html;
		previewSize = size;
		return new Uint8Array([0x89, 0x50]);
	});
});
afterEach(() => {
	pdf.setPdfRendererForTests(undefined);
	pdf.setPreviewRendererForTests(undefined);
});

describe('Empfaengervalidierung', () => {
	const gen = (recipient: string[]) =>
		pdf.generate(ctxWith(), { title: 'T', content: [], template: 'testbrief', recipient });

	it('lehnt zu viele, zu lange, leere und Steuerzeichen-Zeilen ab', async () => {
		await expect(gen(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).rejects.toMatchObject({
			code: 'bad_request'
		});
		await expect(gen(['x'.repeat(61)])).rejects.toMatchObject({ code: 'bad_request' });
		await expect(gen(['Max', '   '])).rejects.toMatchObject({ code: 'bad_request' });
		await expect(gen(['Ma\nx'])).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('akzeptiert gueltige Zeilen und trimmt sie', async () => {
		await gen(['  Max <Mustermann>  ', 'Weg 1']);
		expect(rendered!.html).toContain('Max &lt;Mustermann&gt;|Weg 1');
	});
});

describe('Vorlagen mit festem Seitenlayout', () => {
	it('ueberschreibt Format, Raender und Kopf/Fuss; Reihenfolge overlay, titleBlock, Inhalt', async () => {
		await pdf.generate(ctxWith(), {
			title: 'T',
			template: 'testbrief',
			format: 'A5',
			margins: { top: '1mm' },
			recipient: ['A'],
			content: [{ type: 'paragraph', text: 'INHALT' }]
		});
		expect(rendered!.options).toMatchObject({
			format: 'A4',
			landscape: false,
			margins: { top: '10mm', right: '20mm', bottom: '30mm', left: '40mm' },
			displayHeaderFooter: false,
			headerTemplate: '<span></span>',
			footerTemplate: '<span></span>'
		});
		const h = rendered!.html;
		expect(h.indexOf('class="overlay"')).toBeGreaterThan(-1);
		expect(h.indexOf('class="overlay"')).toBeLessThan(h.indexOf('class="tb"'));
		expect(h.indexOf('class="tb"')).toBeLessThan(h.indexOf('INHALT'));
	});

	it('Vorlagen ohne page bleiben unveraendert', async () => {
		await pdf.generate(ctxWith(), { title: 'T', content: [], template: 'default' });
		expect(rendered!.options).toMatchObject({
			format: 'A3',
			landscape: true,
			margins: { top: '25mm' },
			displayHeaderFooter: true
		});
	});

	it('buildDocumentHtml funktioniert ohne viertes Argument', () => {
		const t = pdf.listTemplates().length;
		expect(t).toBeGreaterThan(0);
		const html = pdf.buildDocumentHtml(
			letter,
			{
				title: 'X',
				organization: { name: '', address: '', email: '', phone: '' },
				logoDataUrl: null,
				headerText: '',
				footerText: '',
				accentColor: '#000000',
				createdAt: new Date(),
				locale: 'de-DE'
			},
			[]
		);
		expect(html).toContain('class="overlay"></div>');
	});
});

describe('renderTemplatePreview', () => {
	it('unbekannte Vorlage -> 404', async () => {
		await expect(pdf.renderTemplatePreview({ template: 'nope' })).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('ungueltiges only -> 400', async () => {
		await expect(
			pdf.renderTemplatePreview({ template: 'testbrief', only: 'unbekannt' })
		).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('reicht HTML mit Beispielinhalt und Seitenrand an den Renderer', async () => {
		const png = await pdf.renderTemplatePreview({ template: 'testbrief', only: 'adressfeld' });
		expect(png).toBeInstanceOf(Uint8Array);
		expect(previewHtml).toContain('Max Mustermann');
		expect(previewHtml).toContain('padding:10mm 20mm 30mm 40mm');
		expect(previewHtml).toContain('html,body{margin:0}');
		expect(previewSize).toEqual({ width: 794, height: 1123 });
	});

	it('hochkant-Vorlage -> 794x1123 und width:210mm', async () => {
		await pdf.renderTemplatePreview({ template: 'stamm-brief' });
		expect(previewSize).toEqual({ width: 794, height: 1123 });
		expect(previewHtml).toContain('width:210mm');
		expect(previewHtml).not.toContain('width:297mm');
	});

	it('Quer-Vorlage stamm-briefkopf-quer -> 1123x794 und width:297mm', async () => {
		await pdf.renderTemplatePreview({ template: 'stamm-briefkopf-quer' });
		expect(previewSize).toEqual({ width: 1123, height: 794 });
		expect(previewHtml).toContain('width:297mm');
		expect(previewHtml).not.toContain('width:210mm');
	});

	it('Quer-Vorlage hat kein Adressfeld -> only adressfeld ist 400', async () => {
		await expect(
			pdf.renderTemplatePreview({ template: 'stamm-briefkopf-quer', only: 'adressfeld' })
		).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('describeTemplates liefert die Ausrichtung', () => {
		const all = pdf.describeTemplates();
		const quer = all.find((t) => t.id === 'stamm-briefkopf-quer');
		expect(quer).toBeDefined();
		expect(quer!.orientation).toBe('landscape');
		expect(quer!.parts.map((p) => p.id)).toEqual(['briefkopf', 'fusszeile']);
		expect(all.find((t) => t.id === 'stamm-brief')?.orientation).toBe('portrait');
		expect(all.find((t) => t.id === 'testbrief')?.orientation).toBe('portrait');
	});

	it('stamm-Vorlagen sind registriert und renderbar', async () => {
		const ids = pdf.listTemplates().map((t) => t.id);
		for (const id of ['stamm-brief', 'stamm-briefkopf']) {
			expect(ids).toContain(id);
			await pdf.generate(ctxWith(), {
				title: 'T',
				template: id,
				recipient: ['Max Mustermann', 'Weg 1', '28207 Bremen'],
				content: []
			});
			expect(rendered!.options.displayHeaderFooter).toBe(false);
		}
		expect(pdf.describeTemplates().length).toBe(ids.length);
	});
});
