import { chromium, type Browser } from 'playwright';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type {
	PdfAttachment,
	PdfFormat,
	PdfGenerateInput,
	PdfMargins,
	PdfOrientation,
	PdfResult,
	RequestContext
} from '$lib/sdk/types';
import { errors } from '../errors';
import { getSettings } from '../settings/service';
import { readFileByIdUnchecked, upload } from '../storage';
import {
	escapeHtml,
	describeTemplates,
	getTemplate,
	listTemplates,
	registerTemplate,
	renderBlocks,
	type PdfLayoutData,
	type PdfTemplate,
	type PdfTemplateInput
} from './templates';
import { loadTemplates } from './load-templates';
import { sampleContent, SAMPLE_RECIPIENT } from './sample';

export { registerTemplate, listTemplates, describeTemplates, escapeHtml };
export type { PdfTemplate, PdfLayoutData, PdfTemplateInput };

loadTemplates();

const MAX_BLOCKS = 5000;
const MAX_TITLE = 200;
const CSS_LENGTH = /^\d+(\.\d+)?(mm|cm|in|px)$/;
const FORMATS: PdfFormat[] = ['A3', 'A4', 'A5', 'Letter', 'Legal'];

export interface RenderOptions {
	format: PdfFormat;
	landscape: boolean;
	margins: PdfMargins;
	displayHeaderFooter: boolean;
	headerTemplate: string;
	footerTemplate: string;
}

export type PdfRenderer = (html: string, options: RenderOptions) => Promise<Uint8Array>;

// ---------------------------------------------------------------------------
// Chromium
// ---------------------------------------------------------------------------

let browserPromise: Promise<Browser> | undefined;

function getBrowser(): Promise<Browser> {
	browserPromise ??= chromium
		.launch({ args: ['--disable-dev-shm-usage', '--no-sandbox'] })
		.then((b) => {
			b.on('disconnected', () => (browserPromise = undefined));
			return b;
		})
		.catch((e: unknown) => {
			browserPromise = undefined;
			throw e;
		});
	return browserPromise;
}

export async function closePdfBrowser(): Promise<void> {
	const p = browserPromise;
	browserPromise = undefined;
	if (p) await (await p).close().catch(() => undefined);
}

const chromiumRenderer: PdfRenderer = async (html, o) => {
	let browser: Browser;
	try {
		browser = await getBrowser();
	} catch {
		throw errors.unavailable('PDF-Engine (Chromium) konnte nicht gestartet werden');
	}
	const context = await browser.newContext({ javaScriptEnabled: false, acceptDownloads: false });
	try {
		// Keine externen Ressourcen: nur Data-URLs und das Dokument selbst
		await context.route('**/*', (route) => {
			const url = route.request().url();
			return url.startsWith('data:') || url === 'about:blank' ? route.continue() : route.abort();
		});
		const page = await context.newPage();
		await page.setContent(html, { waitUntil: 'load' });
		const pdf = await page.pdf({
			format: o.format,
			landscape: o.landscape,
			margin: o.margins,
			printBackground: true,
			displayHeaderFooter: o.displayHeaderFooter,
			headerTemplate: o.headerTemplate,
			footerTemplate: o.footerTemplate
		});
		return new Uint8Array(pdf);
	} finally {
		await context.close().catch(() => undefined);
	}
};

let renderer: PdfRenderer = chromiumRenderer;

/** Ersetzt Chromium durch einen Testadapter. */
export function setPdfRendererForTests(fn: PdfRenderer | undefined): void {
	renderer = fn ?? chromiumRenderer;
}

// ---------------------------------------------------------------------------
// Dokumentaufbau
// ---------------------------------------------------------------------------

export function buildDocumentHtml(
	template: PdfTemplate,
	data: PdfLayoutData,
	content: PdfGenerateInput['content'],
	input?: PdfTemplateInput
): string {
	return `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'" />
<title>${escapeHtml(data.title)}</title>
<style>${template.css(data)}</style></head>
<body>${template.overlay?.(data, input) ?? ''}${template.titleBlock?.(data, input) ?? ''}${renderBlocks(content)}</body></html>`;
}

export function sanitizeFileName(title: string): string {
	const base = title
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	return `${base || 'dokument'}.pdf`;
}

async function loadLogo(fileId: string): Promise<string | null> {
	if (!fileId) return null;
	const file = await readFileByIdUnchecked(fileId);
	if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.contentType)) return null;
	return `data:${file.contentType};base64,${Buffer.from(file.buffer).toString('base64')}`;
}

const MAX_RECIPIENT_LINES = 6;
const MAX_RECIPIENT_LINE = 60;
const CONTROL_CHARS = /\p{Cc}/u;

export function validateRecipient(recipient: string[] | undefined): string[] | undefined {
	if (recipient === undefined) return undefined;
	if (!Array.isArray(recipient) || recipient.length > MAX_RECIPIENT_LINES) {
		throw errors.badRequest('Ungueltige Empfaengeradresse');
	}
	return recipient.map((line) => {
		if (typeof line !== 'string') throw errors.badRequest('Ungueltige Empfaengeradresse');
		const t = line.trim();
		if (!t || t.length > MAX_RECIPIENT_LINE || CONTROL_CHARS.test(t)) {
			throw errors.badRequest('Ungueltige Empfaengeradresse');
		}
		return t;
	});
}

function assertIdentity(ctx: RequestContext): void {
	if (ctx.actor.type !== 'system' && !ctx.userId) throw errors.unauthenticated();
}

async function loadLayout(
	title: string
): Promise<{ s: Awaited<ReturnType<typeof getSettings>>; data: PdfLayoutData }> {
	const s = await getSettings([
		'core.organization.name',
		'core.organization.address',
		'core.organization.email',
		'core.organization.phone',
		'core.design.logoFileId',
		'core.design.accentColor',
		'core.pdf.defaultFormat',
		'core.pdf.defaultOrientation',
		'core.pdf.marginTop',
		'core.pdf.marginRight',
		'core.pdf.marginBottom',
		'core.pdf.marginLeft',
		'core.pdf.headerText',
		'core.pdf.footerText',
		'core.pdf.showLogo'
	]);
	const data: PdfLayoutData = {
		title,
		organization: {
			name: String(s['core.organization.name'] ?? ''),
			address: String(s['core.organization.address'] ?? ''),
			email: String(s['core.organization.email'] ?? ''),
			phone: String(s['core.organization.phone'] ?? '')
		},
		logoDataUrl: s['core.pdf.showLogo']
			? await loadLogo(String(s['core.design.logoFileId'] ?? ''))
			: null,
		headerText: String(s['core.pdf.headerText'] ?? ''),
		footerText: String(s['core.pdf.footerText'] ?? ''),
		accentColor: String(s['core.design.accentColor'] ?? '#2563eb'),
		createdAt: new Date(),
		locale: 'de-DE'
	};
	return { s, data };
}

// ---------------------------------------------------------------------------
// Anlagen
// ---------------------------------------------------------------------------

const MAX_ATTACHMENTS = 80;
const MAX_ATTACHMENT_BYTES = 60 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function checkAttachmentLimits(list: PdfAttachment[]): void {
	const total = list.reduce((a, x) => a + (x.data?.byteLength ?? 0), 0);
	if (list.length > MAX_ATTACHMENTS || total > MAX_ATTACHMENT_BYTES) {
		throw errors.badRequest('Zu viele oder zu grosse Anlagen');
	}
}

function pdfSafeText(text: string): string {
	return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').slice(0, 120);
}

function attachmentPageHtml(a: PdfAttachment, body: string, first: boolean): string {
	return `<section style="${first ? '' : 'break-before:page;'}break-inside:avoid;">
<div style="font-size:14pt;font-weight:bold;color:#111827;line-height:1.3;">${escapeHtml(a.label)}</div>
${a.caption ? `<div style="font-size:10pt;line-height:1.4;color:#6b7280;margin-top:1.5mm;">${escapeHtml(a.caption)}</div>` : ''}
<div style="margin-top:5mm;border-top:0.5pt solid #d1d5db;padding-top:5mm;">${body}</div></section>`;
}

async function appendAttachments(
	main: Uint8Array,
	attachments: PdfAttachment[],
	o: { format: PdfFormat; landscape: boolean; title: string }
): Promise<Uint8Array> {
	type Plan =
		{ kind: 'pdf'; doc: PDFDocument; att: PdfAttachment } | { kind: 'html'; att: PdfAttachment };
	const plans: Plan[] = [];
	const htmlPages: string[] = [];
	for (const att of attachments) {
		if (att.contentType === 'application/pdf') {
			try {
				const doc = await PDFDocument.load(att.data, { ignoreEncryption: false });
				plans.push({ kind: 'pdf', doc, att });
				continue;
			} catch {
				// fällt auf Platzhalter zurück
			}
		} else if (IMAGE_TYPES.has(att.contentType)) {
			const src = `data:${att.contentType};base64,${Buffer.from(att.data).toString('base64')}`;
			htmlPages.push(
				attachmentPageHtml(
					att,
					`<img src="${src}" style="max-width:100%;max-height:215mm;object-fit:contain;" />`,
					htmlPages.length === 0
				)
			);
			plans.push({ kind: 'html', att });
			continue;
		}
		htmlPages.push(
			attachmentPageHtml(
				att,
				'<p style="font-size:11pt;color:#b91c1c;">Anlage nicht lesbar</p>',
				htmlPages.length === 0
			)
		);
		plans.push({ kind: 'html', att });
	}

	let extra: PDFDocument | undefined;
	if (htmlPages.length) {
		const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'" />
<title>${escapeHtml(o.title)}</title>
<style>* { box-sizing: border-box; } body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; }</style></head>
<body>${htmlPages.join('\n')}</body></html>`;
		const bytes = await renderer(html, {
			format: o.format,
			landscape: o.landscape,
			margins: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
			displayHeaderFooter: false,
			headerTemplate: '<span></span>',
			footerTemplate: '<span></span>'
		});
		try {
			extra = await PDFDocument.load(bytes);
		} catch {
			throw errors.unavailable('PDF-Anlagen konnten nicht erzeugt werden');
		}
		if (extra.getPageCount() < htmlPages.length) {
			throw errors.unavailable('PDF-Anlagen konnten nicht erzeugt werden');
		}
	}

	let mainDoc: PDFDocument;
	try {
		mainDoc = await PDFDocument.load(main);
	} catch {
		throw errors.unavailable('PDF konnte nicht mit Anlagen zusammengefuehrt werden');
	}
	const out = await PDFDocument.create();
	const font = await out.embedStandardFont(StandardFonts.HelveticaBold);
	for (const p of await out.copyPages(mainDoc, mainDoc.getPageIndices())) out.addPage(p);

	const mm = 72 / 25.4;
	let htmlIndex = 0;
	for (const plan of plans) {
		if (plan.kind === 'html') {
			const [p] = await out.copyPages(extra!, [htmlIndex++]);
			out.addPage(p!);
			continue;
		}
		const pages = await out.copyPages(plan.doc, plan.doc.getPageIndices());
		pages.forEach((p, i) => {
			out.addPage(p);
			if (i !== 0) return;
			const text = pdfSafeText(plan.att.label);
			const size = 10;
			const w = font.widthOfTextAtSize(text, size);
			const { height } = p.getSize();
			const x = 8 * mm;
			const y = height - 8 * mm - size;
			p.drawRectangle({
				x: x - 3,
				y: y - 3,
				width: w + 6,
				height: size + 6,
				color: rgb(1, 1, 1)
			});
			p.drawText(text, { x, y, size, font, color: rgb(0, 0, 0) });
		});
	}
	return new Uint8Array(await out.save());
}

const MAX_MERGE_DOCUMENTS = 200;
const MAX_MERGE_BYTES = 200 * 1024 * 1024;

/** Haengt mehrere PDF-Dokumente (Seiten unveraendert) zu einem Dokument zusammen. */
export async function mergePdfs(buffers: Uint8Array[]): Promise<Uint8Array> {
	if (!buffers.length || buffers.length > MAX_MERGE_DOCUMENTS) {
		throw errors.badRequest('Ungueltige Anzahl von Dokumenten');
	}
	if (buffers.reduce((a, b) => a + b.byteLength, 0) > MAX_MERGE_BYTES) {
		throw errors.tooLarge('Dokumente sind zu gross zum Zusammenfuehren');
	}
	const out = await PDFDocument.create();
	for (const buf of buffers) {
		let doc: PDFDocument;
		try {
			doc = await PDFDocument.load(buf);
		} catch {
			throw errors.unavailable('PDF konnte nicht zusammengefuehrt werden');
		}
		for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
	}
	return new Uint8Array(await out.save());
}

/**
 * Erzeugt mehrere Dokumente nacheinander (jedes mit eigener Vorlage/Adresse) und fuegt sie zu einem
 * PDF zusammen. `store`/`attachments` der Einzeleingaben werden ignoriert.
 */
export async function generateMany(
	ctx: RequestContext,
	inputs: PdfGenerateInput[],
	title: string
): Promise<PdfResult> {
	assertIdentity(ctx);
	if (!inputs.length || inputs.length > MAX_MERGE_DOCUMENTS) {
		throw errors.badRequest('Ungueltige Anzahl von Dokumenten');
	}
	const buffers: Uint8Array[] = [];
	for (const input of inputs) {
		const { store: _s, attachments: _a, ...plain } = input;
		void _s;
		void _a;
		buffers.push((await generate(ctx, plain)).buffer);
	}
	return {
		buffer: buffers.length === 1 ? buffers[0]! : await mergePdfs(buffers),
		contentType: 'application/pdf',
		fileName: sanitizeFileName(title)
	};
}

export async function generate(ctx: RequestContext, input: PdfGenerateInput): Promise<PdfResult> {
	assertIdentity(ctx);
	if (!input.title.trim() || input.title.length > MAX_TITLE) {
		throw errors.badRequest('Ungueltiger Dokumenttitel');
	}
	if (input.content.length > MAX_BLOCKS) throw errors.badRequest('Dokument ist zu umfangreich');
	if (input.store && !input.module)
		throw errors.badRequest('`module` ist fuer das Speichern erforderlich');

	const template = getTemplate(input.template ?? 'default');
	if (!template) throw errors.badRequest(`Unbekanntes PDF-Template: ${input.template}`);

	const recipient = validateRecipient(input.recipient);
	const { s, data } = await loadLayout(input.title);

	const page = template.page;
	const format = page
		? (page.format ?? 'A4')
		: (input.format ?? (s['core.pdf.defaultFormat'] as PdfFormat));
	if (!FORMATS.includes(format)) throw errors.badRequest('Ungueltiges Seitenformat');
	const orientation: PdfOrientation =
		input.orientation ?? (page ? 'portrait' : (s['core.pdf.defaultOrientation'] as PdfOrientation));
	const margins: PdfMargins = page
		? { ...page.margins }
		: {
				top: input.margins?.top ?? String(s['core.pdf.marginTop']),
				right: input.margins?.right ?? String(s['core.pdf.marginRight']),
				bottom: input.margins?.bottom ?? String(s['core.pdf.marginBottom']),
				left: input.margins?.left ?? String(s['core.pdf.marginLeft'])
			};
	for (const m of Object.values(margins)) {
		if (!CSS_LENGTH.test(m)) throw errors.badRequest('Ungueltiger Seitenrand');
	}

	const showHeader = input.showHeader ?? true;
	const showFooter = input.showFooter ?? true;

	const html = buildDocumentHtml(template, data, input.content, { recipient });
	const attachments = input.attachments ?? [];
	checkAttachmentLimits(attachments);
	let buffer = await renderer(
		html,
		page
			? {
					format,
					landscape: orientation === 'landscape',
					margins,
					displayHeaderFooter: false,
					headerTemplate: '<span></span>',
					footerTemplate: '<span></span>'
				}
			: {
					format,
					landscape: orientation === 'landscape',
					margins,
					displayHeaderFooter: showHeader || showFooter,
					headerTemplate: showHeader ? template.header(data) : '<span></span>',
					footerTemplate: showFooter ? template.footer(data) : '<span></span>'
				}
	);
	if (attachments.length) {
		buffer = await appendAttachments(buffer, attachments, {
			format,
			landscape: orientation === 'landscape',
			title: input.title
		});
	}

	const fileName = sanitizeFileName(input.title);
	const result: PdfResult = { buffer, contentType: 'application/pdf', fileName };
	if (input.store && input.module) {
		result.stored = await upload(ctx, {
			module: input.module,
			path: input.store.path,
			file: buffer,
			contentType: 'application/pdf',
			name: fileName
		});
	}
	return result;
}

// ---------------------------------------------------------------------------
// Vorschau (PNG der ersten Seite)
// ---------------------------------------------------------------------------

const PREVIEW_WIDTH = 794;
const PREVIEW_HEIGHT = 1123;

export interface PreviewOptions {
	template: string;
	recipient?: string[];
	only?: string;
}

export type PreviewRenderer = (html: string) => Promise<Uint8Array>;

const chromiumPreviewRenderer: PreviewRenderer = async (html) => {
	let browser: Browser;
	try {
		browser = await getBrowser();
	} catch {
		throw errors.unavailable('PDF-Engine (Chromium) konnte nicht gestartet werden');
	}
	const context = await browser.newContext({
		javaScriptEnabled: false,
		acceptDownloads: false,
		viewport: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
		deviceScaleFactor: 1.5
	});
	try {
		await context.route('**/*', (route) => {
			const url = route.request().url();
			return url.startsWith('data:') || url === 'about:blank' ? route.continue() : route.abort();
		});
		const page = await context.newPage();
		await page.setViewportSize({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT });
		await page.emulateMedia({ media: 'print' });
		await page.setContent(html, { waitUntil: 'load' });
		const png = await page.screenshot({
			type: 'png',
			clip: { x: 0, y: 0, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }
		});
		return new Uint8Array(png);
	} finally {
		await context.close().catch(() => undefined);
	}
};

let previewRenderer: PreviewRenderer = chromiumPreviewRenderer;

/** Ersetzt Chromium in der Vorschau durch einen Testadapter. */
export function setPreviewRendererForTests(fn: PreviewRenderer | undefined): void {
	previewRenderer = fn ?? chromiumPreviewRenderer;
}

export async function renderTemplatePreview(options: PreviewOptions): Promise<Uint8Array> {
	const template = getTemplate(options.template);
	if (!template) throw errors.notFound('Vorlage nicht gefunden');
	if (options.only !== undefined && !template.parts?.some((p) => p.id === options.only)) {
		throw errors.badRequest('Unbekannter Bestandteil');
	}
	const recipient = validateRecipient(options.recipient ?? SAMPLE_RECIPIENT);
	const { data } = await loadLayout('Vorschau');
	const m = template.page?.margins;
	const padding = m ? `${m.top} ${m.right} ${m.bottom} ${m.left}` : '0';
	const base = buildDocumentHtml(template, data, sampleContent('Vorschau'), {
		recipient,
		only: options.only
	});
	const extra = `<style>html,body{margin:0}body{width:210mm;padding:${padding}}</style>`;
	const html = base.replace('</head>', `${extra}</head>`);
	return previewRenderer(html);
}
