import type { PdfBlock, PdfFormat, PdfMargins } from '$lib/sdk/types';
import { errors } from '../errors';

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Daten, die der Core fuer Header, Footer und Layout bereitstellt. */
export interface PdfLayoutData {
	title: string;
	organization: { name: string; address: string; email: string; phone: string };
	/** Data-URL; nie eine externe URL */
	logoDataUrl: string | null;
	headerText: string;
	footerText: string;
	accentColor: string;
	createdAt: Date;
	locale: string;
}

/**
 * Ein Template definiert Aussehen des Dokumentinhalts sowie Header und Footer.
 * Header und Footer sind unabhaengig vom Inhalt und werden als Chromium-Templates
 * ausgegeben (nur Inline-Styles; `pageNumber`/`totalPages` werden von Chromium befuellt).
 */
export interface PdfTemplate {
	id: string;
	label: string;
	css(data: PdfLayoutData): string;
	header(data: PdfLayoutData): string;
	footer(data: PdfLayoutData): string;
	/** Optionaler Titelbereich vor dem Inhalt */
	titleBlock?(data: PdfLayoutData, input?: PdfTemplateInput): string;

	// --- Briefvorlagen (feste Seitenelemente, Datei im Ordner `pdf/templates/`) -------------------

	/** Kurzbeschreibung fuer die Admin-Ansicht */
	description?: string;
	/** Quelldatei (nur Anzeige in der Admin-Ansicht), z. B. `templates/stamm-brief.ts` */
	source?: string;
	/**
	 * Festes Seitenlayout: ueberschreibt Format und Raender der Einstellungen und schaltet den
	 * Chromium-Kopf/-Fuss ab (die Vorlage zeichnet alles selbst ueber `overlay`).
	 */
	page?: { format?: PdfFormat; margins: PdfMargins };
	/**
	 * Absolut positionierte Seitenelemente (Kopf, Falzmarken, Adressfeld, Fusszeile). Werden vor dem
	 * Inhalt ausgegeben; `position: fixed` wiederholt sich im Druck auf jeder Seite.
	 */
	overlay?(data: PdfLayoutData, input?: PdfTemplateInput): string;
	/** Bestandteile der Vorlage (Anzeige in der Admin-Ansicht, Maße in mm) */
	parts?: PdfTemplatePart[];
}

/** Eingaben fuer Briefvorlagen (z. B. Empfaengeradresse); von `core.pdf.generate` durchgereicht. */
export interface PdfTemplateInput {
	/** Adresszeilen fuer das Adressfeld (bereits validiert, noch nicht escaped) */
	recipient?: string[];
	/** Nur diesen Bestandteil hervorgehoben/allein zeigen (Vorschau in der Admin-Ansicht) */
	only?: string;
}

/** Bestandteil einer Vorlage; Position/Groesse in mm von der oberen linken Seitenecke. */
export interface PdfTemplatePart {
	id: string;
	label: string;
	description?: string;
	/** Kann weggelassen werden (z. B. Adressfeld, Falzmarken) */
	optional?: boolean;
	x: number;
	y: number;
	width?: number;
	height?: number;
}

const registry = new Map<string, PdfTemplate>();

export function registerTemplate(template: PdfTemplate): void {
	if (!/^[a-z][a-z0-9-]{0,40}$/.test(template.id))
		throw new Error(`Ungueltige Template-ID: ${template.id}`);
	registry.set(template.id, template);
}

export function getTemplate(id: string): PdfTemplate | undefined {
	return registry.get(id);
}

export function listTemplates(): { id: string; label: string }[] {
	return [...registry.values()].map((t) => ({ id: t.id, label: t.label }));
}

/** Vorlagen mit Beschreibung und Bestandteilen (Admin-Ansicht, nur Anzeige). */
export function describeTemplates(): {
	id: string;
	label: string;
	description: string | null;
	source: string | null;
	letterhead: boolean;
	parts: PdfTemplatePart[];
}[] {
	return [...registry.values()].map((t) => ({
		id: t.id,
		label: t.label,
		description: t.description ?? null,
		source: t.source ?? null,
		letterhead: !!t.overlay,
		parts: t.parts ?? []
	}));
}

type TableBlock = Extract<PdfBlock, { type: 'table' }>;

const ALIGNS = new Set(['left', 'right', 'center']);

/** Tabellen bis zu dieser Zeilenzahl werden nie ueber eine Seitengrenze geteilt. */
export const KEEP_TOGETHER_ROWS = 12;

/** Gemeinsamer vertikaler Abstand vor/nach Tabellen (px). */
const TABLE_GAP = '16px';

interface BlockFlow {
	/** Der naechste Block ist eine Summentabelle: nicht zwischen beiden umbrechen */
	keepWithNext: boolean;
	/** Reine Summentabelle direkt unter einer Tabelle: kleiner Abstand davor */
	attachedToPrevious: boolean;
}

/** Formular-Gitter: schwarze 1-px-Linien, nur feste Inline-Styles (CSP erlaubt keine Style-Tags im Block). */
function renderGridTable(b: TableBlock, flow: BlockFlow): string {
	const n = b.columns.length;
	const line = '1px solid #000';
	const cell = `border:${line};padding:6px 8px;vertical-align:top;line-height:1.4;overflow-wrap:anywhere;word-break:break-word;`;
	const align = (i: number): string => {
		const a = b.align?.[i];
		return a && ALIGNS.has(a) ? a : 'left';
	};
	const valid =
		b.widths && b.widths.length === n && b.widths.every((w) => Number.isFinite(w) && w > 0);
	const sum = valid ? b.widths!.reduce((a, w) => a + w, 0) : 0;
	const colHtml = valid
		? '<colgroup>' +
			b.widths!.map((w) => `<col style="width:${((w / sum) * 100).toFixed(3)}%" />`).join('') +
			'</colgroup>'
		: '';
	const tr = (inner: string, extra = '') => `<tr style="break-inside:avoid;${extra}">${inner}</tr>`;
	const td = (i: number, text: string, extra = '') =>
		`<td style="${cell}text-align:${align(i)};${extra}">${escapeHtml(String(text)).replace(/\n/g, '<br/>')}</td>`;

	// Reine Summentabelle (nur Summenzeile): keine leere Spaltenkopfzeile
	const summaryOnly = isSummaryOnly(b);
	let head = '';
	if (b.caption) {
		const hasRight = n >= 2 && b.caption.right !== undefined;
		const wide = hasRight ? n - 1 : n;
		const left = `<th colspan="${Math.max(wide, 1)}" style="${cell}text-align:left;font-weight:bold;">${escapeHtml(b.caption.left)}</th>`;
		const right = hasRight
			? `<th style="${cell}text-align:right;font-weight:bold;">${escapeHtml(b.caption.right ?? '')}</th>`
			: '';
		head += tr(left + right, 'break-after:avoid;');
	}
	if (!b.noHeader && !summaryOnly) {
		head += tr(
			b.columns
				.map(
					(c, i) =>
						`<th style="${cell}text-align:${align(i)};font-weight:bold;background:none;">${escapeHtml(c)}</th>`
				)
				.join(''),
			'break-after:avoid;'
		);
	}
	// Letzte Datenzeile haengt an der Summenzeile (Summe nie allein auf einer Seite)
	const lastIdx = b.rows.length - 1;
	const body = b.rows
		.map((r, ri) =>
			tr(
				r.map((c, i) => td(i, c)).join(''),
				ri === lastIdx && b.totalRow ? 'break-after:avoid;' : ''
			)
		)
		.join('');
	const total = b.totalRow
		? tr(
				b.totalRow.map((c, i) => td(i, c, 'font-weight:bold;border-top:3px double #000;')).join(''),
				'break-before:avoid;'
			)
		: '';
	const keep = b.rows.length <= KEEP_TOGETHER_ROWS ? 'break-inside:avoid;' : '';
	const top = flow.attachedToPrevious ? '6px' : TABLE_GAP;
	const after = flow.keepWithNext ? 'break-after:avoid;' : '';
	return (
		`<div class="grid-table" style="margin:${top} 0 ${TABLE_GAP};${keep}${after}">` +
		`<table style="width:100%;border-collapse:collapse;table-layout:fixed;border:${line};">` +
		colHtml +
		`<thead style="display:table-header-group;">${head}</thead><tbody>${body}${total}</tbody></table></div>`
	);
}

const isGrid = (b: PdfBlock | undefined): boolean => b?.type === 'table' && b.variant === 'grid';

/** Reine Summentabelle: keine Zeilen und keine Beschriftung, nur die Summenzeile. */
function isSummaryOnly(b: PdfBlock | undefined): boolean {
	return !!b && b.type === 'table' && b.rows.length === 0 && !!b.totalRow && !b.caption;
}

const IMAGE_DATA_URL = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const MAX_IMAGE_DATA_URL = 2 * 1024 * 1024;

/** Prueft eingebettete Bilder (nur PNG/JPEG-Data-URL, Breite 5–150 mm). */
function assertImage(dataUrl: string, widthMm: number): void {
	if (!IMAGE_DATA_URL.test(dataUrl) || dataUrl.length > MAX_IMAGE_DATA_URL) {
		throw errors.badRequest('Ungueltiges Bild im Dokument');
	}
	if (!Number.isFinite(widthMm) || widthMm < 5 || widthMm > 150) {
		throw errors.badRequest('Ungueltige Bildbreite');
	}
}

type BoxBlock = Extract<PdfBlock, { type: 'box' }>;

const SAFE_HREF = /^https?:\/\/[^\s"<>]+$/;

/** Link fuer das PDF (in Chromium-PDFs anklickbar); nur http(s). */
function linkHtml(href: string, text: string): string {
	if (!SAFE_HREF.test(href)) throw errors.badRequest('Ungueltiger Link im Dokument');
	return `<a href="${escapeHtml(href)}" style="color:inherit;text-decoration:underline;">${escapeHtml(text)}</a>`;
}

/**
 * Macht http(s)-Adressen in bereits escaptem Text anklickbar. Endet an Leerraum oder escapten
 * Zeichen (`&lt;` usw.); Satzzeichen am Ende bleiben ausserhalb des Links.
 */
const URL_IN_TEXT =
	/https?:\/\/(?:(?!&lt;|&gt;|&quot;|&#39;)[^\s<])+?(?=[.,;:!?)]*(?:\s|<|&lt;|&gt;|&quot;|&#39;|$))/g;

function linkify(escaped: string): string {
	return escaped.replace(
		URL_IN_TEXT,
		(url) => `<a href="${url}" style="color:inherit;">${url}</a>`
	);
}

/** Bild links, Text rechts (ohne Rahmen); zweispaltige Tabelle, nur Inline-Styles. */
function renderBox(b: BoxBlock): string {
	const parts: string[] = [];
	if (b.label) {
		parts.push(`<div style="font-size:10pt;color:#4b5563;">${escapeHtml(b.label)}</div>`);
	}
	if (b.value) {
		parts.push(
			`<div style="font-size:24pt;font-weight:700;letter-spacing:.05em;line-height:1.15;margin:.5mm 0 1mm;">${escapeHtml(b.value)}</div>`
		);
	}
	for (const line of b.lines ?? []) {
		parts.push(`<div style="font-size:10pt;color:#4b5563;">${escapeHtml(line)}</div>`);
	}
	if (b.linkLabel) {
		parts.push(
			`<div style="font-size:10pt;color:#4b5563;margin-top:4mm;">${escapeHtml(b.linkLabel)}</div>`
		);
	}
	if (b.link) {
		parts.push(
			`<div style="font-size:10pt;overflow-wrap:anywhere;word-break:break-all;${b.linkLabel ? '' : 'margin-top:4mm;'}">${linkHtml(b.link.href, b.link.text ?? b.link.href)}</div>`
		);
	}
	const cell = 'border:0;padding:0;vertical-align:middle;background:none;';
	let image = '';
	if (b.image) {
		assertImage(b.image.dataUrl, b.image.widthMm);
		const img = `<img src="${b.image.dataUrl}" alt="${escapeHtml(b.image.alt ?? '')}" style="display:block;width:${b.image.widthMm}mm;height:auto;" />`;
		// Bild verlinkt, wenn ein Link angegeben ist (QR-Code im PDF anklickbar)
		const inner =
			b.link && SAFE_HREF.test(b.link.href)
				? `<a href="${escapeHtml(b.link.href)}">${img}</a>`
				: img;
		image = `<td style="${cell}width:${b.image.widthMm}mm;padding-right:6mm;">${inner}</td>`;
	}
	return (
		'<table class="pdf-box" style="width:100%;border-collapse:collapse;margin:5mm 0 6mm;table-layout:auto;break-inside:avoid;"><tr style="break-inside:avoid;">' +
		image +
		`<td style="${cell}">${parts.join('')}</td></tr></table>`
	);
}

export function renderBlocks(blocks: PdfBlock[]): string {
	const out: string[] = [];
	// Harte Seitenumbrueche: nie am Anfang oder Ende, aufeinanderfolgende werden zu einem
	let pendingBreak = false;
	blocks.forEach((b, idx) => {
		if (b.type === 'pageBreak') {
			pendingBreak = out.length > 0;
			return;
		}
		const next = blocks[idx + 1];
		const flow: BlockFlow = {
			keepWithNext: isGrid(b) && isSummaryOnly(next),
			attachedToPrevious: isSummaryOnly(b) && isGrid(blocks[idx - 1])
		};
		if (pendingBreak) {
			out.push('<div class="page-break" style="break-before:page;height:0;"></div>');
			pendingBreak = false;
		}
		switch (b.type) {
			case 'heading': {
				const level = b.level ?? 2;
				out.push(`<h${level}>${escapeHtml(b.text)}</h${level}>`);
				break;
			}
			case 'paragraph': {
				// Absatz direkt vor einer Tabelle bleibt mit ihr zusammen
				const keep = next?.type === 'table' ? ' style="break-after:avoid;"' : '';
				out.push(`<p${keep}>${linkify(escapeHtml(b.text)).replace(/\n/g, '<br/>')}</p>`);
				break;
			}
			case 'list': {
				const tag = b.ordered ? 'ol' : 'ul';
				out.push(
					`<${tag}>${b.items.map((i) => `<li>${linkify(escapeHtml(i))}</li>`).join('')}</${tag}>`
				);
				break;
			}
			case 'image': {
				assertImage(b.dataUrl, b.widthMm);
				const align = b.align === 'center' ? 'margin:0 auto;' : '';
				out.push(
					`<img src="${b.dataUrl}" alt="${escapeHtml(b.alt ?? '')}" style="display:block;width:${b.widthMm}mm;height:auto;${align}break-inside:avoid;" />`
				);
				break;
			}
			case 'box':
				out.push(renderBox(b));
				break;
			case 'table':
				if (b.variant === 'grid') {
					out.push(renderGridTable(b, flow));
					break;
				}
				out.push(
					`<table${b.rows.length <= KEEP_TOGETHER_ROWS ? ' class="keep"' : ''}><thead><tr>` +
						b.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('') +
						'</tr></thead><tbody>' +
						b.rows
							.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`)
							.join('') +
						'</tbody></table>'
				);
				break;
		}
	});
	return out.join('\n');
}

export const safeColor = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c) ? c : '#2563eb');

function formatDate(d: Date, locale: string): string {
	return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d);
}

export function baseCss(data: PdfLayoutData, fontSize: string): string {
	const accent = safeColor(data.accentColor);
	return `
		* { box-sizing: border-box; }
		body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: ${fontSize}; color: #111827; line-height: 1.45; margin: 0; orphans: 2; widows: 2; }
		h1, h2, h3 { break-after: avoid; break-inside: avoid; line-height: 1.25; }
		h1 { font-size: 1.7em; margin: 1.4em 0 .6em; color: ${accent}; }
		h2 { font-size: 1.3em; margin: 1.6em 0 .6em; }
		h3 { font-size: 1.1em; margin: 1.3em 0 .45em; }
		h1.doc-title { margin-top: 0; }
		p { margin: 0 0 .8em; }
		ul, ol { margin: 0 0 .9em; padding-left: 1.4em; break-inside: avoid; }
		li { margin: 0 0 .25em; }
		table { width: 100%; border-collapse: collapse; margin: 16px 0; }
		table.keep { break-inside: avoid; }
		th, td { border-bottom: 1px solid #d1d5db; padding: 6px 8px; text-align: left; vertical-align: top; }
		th { background: #f3f4f6; font-weight: 600; }
		tr { break-inside: avoid; }
		thead { display: table-header-group; }
	`;
}

function headerHtml(data: PdfLayoutData, size: string): string {
	const logo = data.logoDataUrl
		? `<img src="${data.logoDataUrl}" style="height:28px;max-width:140px;object-fit:contain;" />`
		: '';
	const left =
		logo || `<span style="font-weight:600;">${escapeHtml(data.organization.name)}</span>`;
	return `<div style="width:100%;font-size:${size};padding:0 18mm;display:flex;justify-content:space-between;align-items:center;color:#374151;font-family:Arial,sans-serif;">
		<div style="display:flex;align-items:center;gap:8px;">${left}${
			logo && data.organization.name
				? `<span style="font-weight:600;">${escapeHtml(data.organization.name)}</span>`
				: ''
		}</div>
		<div>${escapeHtml(data.headerText)}</div>
	</div>`;
}

function footerHtml(data: PdfLayoutData, size: string): string {
	return `<div style="width:100%;font-size:${size};padding:0 18mm;display:flex;justify-content:space-between;color:#6b7280;font-family:Arial,sans-serif;">
		<span>${escapeHtml(formatDate(data.createdAt, data.locale))}</span>
		<span>${escapeHtml(data.footerText)}</span>
		<span>Seite <span class="pageNumber"></span> von <span class="totalPages"></span></span>
	</div>`;
}

export const defaultTemplate: PdfTemplate = {
	id: 'default',
	label: 'Standard',
	css: (d) => baseCss(d, '10.5pt'),
	header: (d) => headerHtml(d, '9px'),
	footer: (d) => footerHtml(d, '8px'),
	titleBlock: (d) => `<h1 class="doc-title">${escapeHtml(d.title)}</h1>`
};

export const compactTemplate: PdfTemplate = {
	id: 'compact',
	label: 'Kompakt',
	css: (d) =>
		baseCss(d, '9pt') +
		' th, td { padding: 4px 6px; } p { margin-bottom: .5em; } table { margin: 12px 0; }',
	header: (d) => headerHtml(d, '8px'),
	footer: (d) => footerHtml(d, '7px'),
	titleBlock: (d) => `<h1 class="doc-title" style="font-size:1.3em">${escapeHtml(d.title)}</h1>`
};

registerTemplate(defaultTemplate);
registerTemplate(compactTemplate);
