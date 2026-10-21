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
import { env } from '../env';
import { errors } from '../errors';
import { safeFileName } from '$lib/sdk/file-names';
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

export type ChromiumSandboxMode = 'auto' | 'on' | 'off';

/**
 * Startversuche für Chromium je Sandbox-Modus (#67, 01a-13), der Reihe nach. Playwright startet Chromium
 * ohne `chromiumSandbox: true` immer mit `--no-sandbox` – daher wird die Sandbox hier ausdrücklich verlangt.
 * `auto` fällt nur zurück, wenn der Start mit Sandbox scheitert (z. B. Docker ohne passendes seccomp-Profil).
 */
export function chromiumLaunchAttempts(
	mode: ChromiumSandboxMode
): { chromiumSandbox: boolean; args: string[] }[] {
	const args = ['--disable-dev-shm-usage'];
	const sandboxed = { chromiumSandbox: true, args };
	const unsandboxed = { chromiumSandbox: false, args: [...args, '--no-sandbox'] };
	if (mode === 'on') return [sandboxed];
	if (mode === 'off') return [unsandboxed];
	return [sandboxed, unsandboxed];
}

function sandboxMode(): ChromiumSandboxMode {
	try {
		return env().PDF_CHROMIUM_SANDBOX;
	} catch {
		return 'auto';
	}
}

async function launchChromium(): Promise<Browser> {
	const attempts = chromiumLaunchAttempts(sandboxMode());
	let lastError: unknown;
	for (const [i, opts] of attempts.entries()) {
		try {
			const browser = await chromium.launch(opts);
			if (i > 0) {
				console.warn(
					'[pdf] Chromium läuft OHNE Sandbox (Start mit Sandbox fehlgeschlagen). ' +
						'Siehe docs/security.md → „PDF-Renderer“; PDF_CHROMIUM_SANDBOX=on|off setzt den Modus fest.'
				);
			}
			return browser;
		} catch (e) {
			lastError = e;
		}
	}
	throw lastError;
}

function getBrowser(): Promise<Browser> {
	browserPromise ??= launchChromium()
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

/** PDF-Dateiname aus dem Titel (ASCII, `-` statt Sonderzeichen, ≤ 80 Zeichen + `.pdf`) */
export function sanitizeFileName(title: string): string {
	return `${safeFileName(title, { replacement: '-', maxLength: 80, fallback: 'dokument' })}.pdf`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Logo als Data-URL. Nur Dateien aus dem Core-Bereich `branding/` (Logo-Upload der Einstellungen): Eine frei
 * gesetzte ID darf keine fremden Modul-Dateien (Mitglieds-/Galeriebilder) in PDFs holen (#67, 01a-08).
 * Exportiert für Tests.
 */
export async function loadLogo(fileId: string): Promise<string | null> {
	if (!fileId || !UUID_RE.test(fileId)) return null;
	const file = await readFileByIdUnchecked(fileId, { module: 'core', pathPrefix: 'branding/' });
	if (!file || !/^image\/(png|jpeg|gif|webp)$/.test(file.contentType)) return null;
	return `data:${file.contentType};base64,${Buffer.from(file.buffer).toString('base64')}`;
}

const MAX_RECIPIENT_LINES = 6;
const MAX_RECIPIENT_LINE = 60;
const CONTROL_CHARS = /\p{Cc}/u;

export function validateRecipient(recipient: string[] | undefined): string[] | undefined {
	if (recipient === undefined) return undefined;
	if (!Array.isArray(recipient) || recipient.length > MAX_RECIPIENT_LINES) {
		throw errors.badRequest('Ungültige Empfängeradresse');
	}
	return recipient.map((line) => {
		if (typeof line !== 'string') throw errors.badRequest('Ungültige Empfängeradresse');
		const t = line.trim();
		if (!t || t.length > MAX_RECIPIENT_LINE || CONTROL_CHARS.test(t)) {
			throw errors.badRequest('Ungültige Empfängeradresse');
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
		throw errors.badRequest('Zu viele oder zu große Anlagen');
	}
}

function pdfSafeText(text: string): string {
	return text.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').slice(0, 120);
}

/**
 * Maximale Bildhöhe einer Bild-Anlage. Seitenränder 15 mm; Titel (14pt x 1,3 ~ 6,4 mm),
 * einzeilige Beschriftung (1,5 mm + 10pt x 1,4 ~ 6,4 mm) und Trennlinie (5 mm + 0,5pt + 5 mm
 * ~ 10,2 mm) belegen zusammen ~ 23 mm.
 * - Hochkant A4: 297 - 30 - 23 = 244 mm frei -> 215 mm (unverändert, Reserve für lange Texte).
 * - Quer A4: 210 - 30 - 23 = 157 mm frei -> 145 mm (Reserve für ~2 weitere Beschriftungszeilen).
 */
const ATTACHMENT_IMAGE_MAX_HEIGHT = { portrait: '215mm', landscape: '145mm' } as const;

function attachmentPageHtml(a: PdfAttachment, body: string, first: boolean): string {
	return `<section style="${first ? '' : 'break-before:page;'}break-inside:avoid;">
<div style="font-size:14pt;font-weight:bold;color:#111827;line-height:1.3;">${escapeHtml(a.label)}</div>
${a.caption ? `<div style="font-size:10pt;line-height:1.4;color:#6b7280;margin-top:1.5mm;">${escapeHtml(a.caption)}</div>` : ''}
<div style="margin-top:5mm;border-top:0.5pt solid #d1d5db;padding-top:5mm;">${body}</div></section>`;
}

function attachmentBody(att: PdfAttachment, landscape: boolean): string | null {
	if (!IMAGE_TYPES.has(att.contentType)) return null;
	const src = `data:${att.contentType};base64,${Buffer.from(att.data).toString('base64')}`;
	const maxHeight = ATTACHMENT_IMAGE_MAX_HEIGHT[landscape ? 'landscape' : 'portrait'];
	return `<img src="${src}" style="max-width:100%;max-height:${maxHeight};object-fit:contain;" />`;
}

async function appendAttachments(
	main: Uint8Array,
	attachments: PdfAttachment[],
	o: { format: PdfFormat; landscape: boolean; title: string }
): Promise<Uint8Array> {
	type Plan =
		| { kind: 'pdf'; doc: PDFDocument; att: PdfAttachment }
		| { kind: 'html'; att: PdfAttachment; body: string; doc?: PDFDocument; pages?: number[] };
	const plans: Plan[] = [];
	for (const att of attachments) {
		if (att.contentType === 'application/pdf') {
			try {
				const doc = await PDFDocument.load(att.data, { ignoreEncryption: false });
				plans.push({ kind: 'pdf', doc, att });
				continue;
			} catch {
				// fällt auf Platzhalter zurück
			}
		}
		const body =
			attachmentBody(att, o.landscape) ??
			'<p style="font-size:11pt;color:#b91c1c;">Anlage nicht lesbar</p>';
		plans.push({ kind: 'html', att, body });
	}

	const renderSections = async (sections: string[]): Promise<PDFDocument> => {
		const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'" />
<title>${escapeHtml(o.title)}</title>
<style>* { box-sizing: border-box; } body { font-family: "Helvetica Neue", Arial, sans-serif; margin: 0; }</style></head>
<body>${sections.join('\n')}</body></html>`;
		const bytes = await renderer(html, {
			format: o.format,
			landscape: o.landscape,
			margins: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
			displayHeaderFooter: false,
			headerTemplate: '<span></span>',
			footerTemplate: '<span></span>'
		});
		try {
			const doc = await PDFDocument.load(bytes);
			if (doc.getPageCount() < 1) throw new Error('leer');
			return doc;
		} catch {
			throw errors.unavailable('PDF-Anlagen konnten nicht erzeugt werden');
		}
	};

	const htmlPlans = plans.filter((p): p is Extract<Plan, { kind: 'html' }> => p.kind === 'html');
	if (htmlPlans.length) {
		// Normalfall: alle Anlagen in einem Durchgang, genau eine Seite je Anlage
		const combined = await renderSections(
			htmlPlans.map((p, i) => attachmentPageHtml(p.att, p.body, i === 0))
		);
		if (combined.getPageCount() === htmlPlans.length) {
			htmlPlans.forEach((p, i) => {
				p.doc = combined;
				p.pages = [i];
			});
		} else {
			// Überlauf (z. B. sehr lange Beschriftung): Seiten wären nicht mehr eindeutig zuzuordnen,
			// daher jede Anlage einzeln rendern und alle ihre Seiten übernehmen.
			for (const p of htmlPlans) {
				p.doc = await renderSections([attachmentPageHtml(p.att, p.body, true)]);
				p.pages = p.doc.getPageIndices();
			}
		}
	}

	let mainDoc: PDFDocument;
	try {
		mainDoc = await PDFDocument.load(main);
	} catch {
		throw errors.unavailable('PDF konnte nicht mit Anlagen zusammengeführt werden');
	}
	const out = await PDFDocument.create();
	const font = await out.embedStandardFont(StandardFonts.HelveticaBold);
	for (const p of await out.copyPages(mainDoc, mainDoc.getPageIndices())) out.addPage(p);

	const mm = 72 / 25.4;
	for (const plan of plans) {
		if (plan.kind === 'html') {
			for (const p of await out.copyPages(plan.doc!, plan.pages!)) out.addPage(p);
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

/** Hängt mehrere PDF-Dokumente (Seiten unverändert) zu einem Dokument zusammen. */
export async function mergePdfs(buffers: Uint8Array[]): Promise<Uint8Array> {
	if (!buffers.length || buffers.length > MAX_MERGE_DOCUMENTS) {
		throw errors.badRequest('Ungültige Anzahl von Dokumenten');
	}
	if (buffers.reduce((a, b) => a + b.byteLength, 0) > MAX_MERGE_BYTES) {
		throw errors.tooLarge('Dokumente sind zu groß zum Zusammenführen');
	}
	const out = await PDFDocument.create();
	for (const buf of buffers) {
		let doc: PDFDocument;
		try {
			doc = await PDFDocument.load(buf);
		} catch {
			throw errors.unavailable('PDF konnte nicht zusammengeführt werden');
		}
		for (const p of await out.copyPages(doc, doc.getPageIndices())) out.addPage(p);
	}
	return new Uint8Array(await out.save());
}

/**
 * Erzeugt mehrere Dokumente nacheinander (jedes mit eigener Vorlage/Adresse) und fügt sie zu einem
 * PDF zusammen. `store`/`attachments` der Einzeleingaben werden ignoriert.
 */
export async function generateMany(
	ctx: RequestContext,
	inputs: PdfGenerateInput[],
	title: string
): Promise<PdfResult> {
	assertIdentity(ctx);
	if (!inputs.length || inputs.length > MAX_MERGE_DOCUMENTS) {
		throw errors.badRequest('Ungültige Anzahl von Dokumenten');
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
		throw errors.badRequest('Ungültiger Dokumenttitel');
	}
	if (input.content.length > MAX_BLOCKS) throw errors.badRequest('Dokument ist zu umfangreich');
	if (input.store && !input.module)
		throw errors.badRequest('`module` ist für das Speichern erforderlich');

	const template = getTemplate(input.template ?? 'default');
	if (!template) throw errors.badRequest(`Unbekanntes PDF-Template: ${input.template}`);

	const recipient = validateRecipient(input.recipient);
	const { s, data } = await loadLayout(input.title);

	const page = template.page;
	const format = page
		? (page.format ?? 'A4')
		: (input.format ?? (s['core.pdf.defaultFormat'] as PdfFormat));
	if (!FORMATS.includes(format)) throw errors.badRequest('Ungültiges Seitenformat');
	// Festes Seitenlayout bestimmt die Ausrichtung selbst (sonst passt der Briefkopf nicht)
	const orientation: PdfOrientation = page
		? (page.orientation ?? 'portrait')
		: (input.orientation ?? (s['core.pdf.defaultOrientation'] as PdfOrientation));
	const margins: PdfMargins = page
		? { ...page.margins }
		: {
				top: input.margins?.top ?? String(s['core.pdf.marginTop']),
				right: input.margins?.right ?? String(s['core.pdf.marginRight']),
				bottom: input.margins?.bottom ?? String(s['core.pdf.marginBottom']),
				left: input.margins?.left ?? String(s['core.pdf.marginLeft'])
			};
	for (const m of Object.values(margins)) {
		if (!CSS_LENGTH.test(m)) throw errors.badRequest('Ungültiger Seitenrand');
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

/** A4 bei 96 dpi; quer werden Breite und Höhe getauscht. */
const PREVIEW_WIDTH = 794;
const PREVIEW_HEIGHT = 1123;

export interface PreviewOptions {
	template: string;
	recipient?: string[];
	only?: string;
}

export type PreviewRenderer = (
	html: string,
	size: { width: number; height: number }
) => Promise<Uint8Array>;

const chromiumPreviewRenderer: PreviewRenderer = async (html, { width, height }) => {
	let browser: Browser;
	try {
		browser = await getBrowser();
	} catch {
		throw errors.unavailable('PDF-Engine (Chromium) konnte nicht gestartet werden');
	}
	const context = await browser.newContext({
		javaScriptEnabled: false,
		acceptDownloads: false,
		viewport: { width, height },
		deviceScaleFactor: 1.5
	});
	try {
		await context.route('**/*', (route) => {
			const url = route.request().url();
			return url.startsWith('data:') || url === 'about:blank' ? route.continue() : route.abort();
		});
		const page = await context.newPage();
		await page.setViewportSize({ width, height });
		await page.emulateMedia({ media: 'print' });
		await page.setContent(html, { waitUntil: 'load' });
		const png = await page.screenshot({
			type: 'png',
			clip: { x: 0, y: 0, width, height }
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
	const base = buildDocumentHtml(template, data, sampleContent(), {
		recipient,
		only: options.only
	});
	const landscape = template.page?.orientation === 'landscape';
	const extra = `<style>html,body{margin:0}body{width:${landscape ? 297 : 210}mm;padding:${padding}}</style>`;
	const html = base.replace('</head>', `${extra}</head>`);
	return previewRenderer(
		html,
		landscape
			? { width: PREVIEW_HEIGHT, height: PREVIEW_WIDTH }
			: { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }
	);
}
