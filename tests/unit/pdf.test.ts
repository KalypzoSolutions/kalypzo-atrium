import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ctxWith, settingsStore, systemCtx } from './_helpers';

vi.mock('$lib/server/core/settings/service', () => ({
	getSettings: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settingsStore[k]])),
	getSetting: async (k: string) => settingsStore[k]
}));
const upload = vi.hoisted(() =>
	vi.fn(async (_ctx: unknown, input: { module: string; path: string }) => ({
		id: 'f1',
		module: input.module,
		path: input.path,
		name: 'x.pdf',
		size: 3,
		contentType: 'application/pdf',
		createdAt: new Date().toISOString()
	}))
);
vi.mock('$lib/server/core/storage', () => ({
	upload,
	readFileByIdUnchecked: async () => null
}));

import * as pdf from '$lib/server/core/pdf';
import type { RenderOptions } from '$lib/server/core/pdf';

let rendered: { html: string; options: RenderOptions } | undefined;

beforeEach(() => {
	rendered = undefined;
	upload.mockClear();
	Object.assign(settingsStore, {
		'core.organization.name': 'Muster <e.V.>',
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
		'core.pdf.headerText': 'Intern',
		'core.pdf.footerText': 'Vertraulich',
		'core.pdf.showLogo': true
	});
	pdf.setPdfRendererForTests(async (html, options) => {
		rendered = { html, options };
		return new Uint8Array([0x25, 0x50, 0x44]);
	});
});
afterEach(() => pdf.setPdfRendererForTests(undefined));

describe('PDF-Service', () => {
	it('erzeugt ein PDF mit Standardwerten aus den Einstellungen', async () => {
		const res = await pdf.generate(ctxWith(), {
			title: 'Mitgliederliste',
			content: [{ type: 'heading', text: 'Überschrift' }]
		});
		expect(res.fileName).toBe('Mitgliederliste.pdf');
		expect(res.contentType).toBe('application/pdf');
		expect(rendered?.options).toMatchObject({
			format: 'A4',
			landscape: false,
			margins: { top: '25mm', left: '18mm' },
			displayHeaderFooter: true
		});
		expect(rendered?.options.footerTemplate).toContain('pageNumber');
		expect(rendered?.options.footerTemplate).toContain('totalPages');
		expect(rendered?.options.headerTemplate).toContain('Muster &lt;e.V.&gt;');
	});

	it('übersteuert Format, Ausrichtung und Ränder', async () => {
		await pdf.generate(ctxWith(), {
			title: 'T',
			content: [],
			format: 'A3',
			orientation: 'landscape',
			margins: { top: '10mm' },
			showFooter: false
		});
		expect(rendered?.options).toMatchObject({ format: 'A3', landscape: true });
		expect(rendered?.options.margins.top).toBe('10mm');
		expect(rendered?.options.footerTemplate).not.toContain('pageNumber');
	});

	it('escaped alle Inhalte (keine HTML-Injection)', async () => {
		await pdf.generate(ctxWith(), {
			title: '<script>alert(1)</script>',
			content: [
				{ type: 'paragraph', text: '<img src=x onerror=alert(1)>' },
				{ type: 'table', columns: ['<b>'], rows: [['"><svg>']] },
				{ type: 'list', items: ['<i>'] }
			]
		});
		expect(rendered!.html).not.toContain('<script>alert');
		expect(rendered!.html).not.toContain('<img src=x');
		expect(rendered!.html).not.toContain('<svg>');
		expect(rendered!.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
		expect(rendered!.html).toContain("default-src 'none'");
	});

	it('nutzt Templates und lehnt unbekannte ab', async () => {
		await pdf.generate(ctxWith(), { title: 'T', content: [], template: 'compact' });
		expect(rendered!.html).toContain('font-size:1.3em');
		await expect(
			pdf.generate(ctxWith(), { title: 'T', content: [], template: 'nope' })
		).rejects.toMatchObject({ code: 'bad_request' });
		pdf.registerTemplate({
			id: 'custom',
			label: 'Eigenes',
			css: () => 'body{color:red}',
			header: () => '<i>h</i>',
			footer: () => '<i>f</i>'
		});
		await pdf.generate(ctxWith(), { title: 'T', content: [], template: 'custom' });
		expect(rendered!.options.headerTemplate).toBe('<i>h</i>');
	});

	it('validiert Eingaben und Identität', async () => {
		await expect(
			pdf.generate({ ...ctxWith(), userId: null }, { title: 'T', content: [] })
		).rejects.toMatchObject({ code: 'unauthenticated' });
		await expect(
			pdf.generate(ctxWith(), { title: 'T', content: [], margins: { top: 'url(x)' } })
		).rejects.toMatchObject({ code: 'bad_request' });
		await expect(
			pdf.generate(ctxWith(), { title: 'T', content: [], store: { path: 'a.pdf' } })
		).rejects.toMatchObject({ code: 'bad_request' });
	});

	it('speichert optional im Storage und bereinigt den Dateinamen', async () => {
		const res = await pdf.generate(systemCtx, {
			title: 'Jahresbericht Ärzte/2024',
			content: [],
			module: 'members',
			store: { path: 'reports/2024.pdf' }
		});
		expect(res.fileName).toBe('Jahresbericht-Arzte-2024.pdf');
		expect(upload).toHaveBeenCalledOnce();
		expect(res.stored?.path).toBe('reports/2024.pdf');
	});
});
