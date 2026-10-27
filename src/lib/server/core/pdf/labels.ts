import type { PdfResult, RequestContext } from '$lib/sdk/types';
import {
	fitLayout,
	labelFormatSchema,
	labelLayoutSchema,
	labelPageSize,
	placeLabels,
	resolveLayout,
	type LabelElement,
	type LabelPdfInput
} from '$lib/sdk/labels';
import { barcodeSvg } from '$lib/sdk/labels/barcode';
import { logoDataUrl } from '$lib/sdk/labels/logos';
import { errors } from '../errors';
import { CARLITO_STACK, carlitoFontFaceCss } from './fonts';
import { escapeHtml } from './templates';
import { pdfRenderer, sanitizeFileName } from './index';

/** Höchstens so viele Etiketten je Dokument */
export const MAX_LABELS = 2000;
const MAX_VALUE_LENGTH = 500;

const n = (v: number) => Math.round(v * 1000) / 1000;
const mm = (v: number) => `${n(v)}mm`;

function box(el: LabelElement, inner: string, extra = ''): string {
	return `<div style="position:absolute;left:${mm(el.x)};top:${mm(el.y)};width:${mm(el.w)};height:${mm(el.h)};${extra}">${inner}</div>`;
}

function renderElement(el: LabelElement): string {
	switch (el.type) {
		case 'text': {
			const justify = { left: 'flex-start', center: 'center', right: 'flex-end' }[el.align];
			const items = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[el.valign];
			const span = `<span style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${el.maxLines};overflow:hidden;text-align:${el.align};white-space:pre-line;overflow-wrap:anywhere;">${escapeHtml(el.text)}</span>`;
			return box(
				el,
				span,
				`display:flex;justify-content:${justify};align-items:${items};overflow:hidden;font-size:${n(el.fontSizePt)}pt;line-height:1.15;font-weight:${el.bold ? 700 : 400};`
			);
		}
		case 'barcode': {
			let svg: string;
			try {
				svg = barcodeSvg(el.symbology, el.value);
			} catch {
				return '';
			}
			return box(el, svg);
		}
		case 'image':
			return box(
				el,
				`<img src="${logoDataUrl(el)}" alt="" style="width:100%;height:100%;object-fit:contain;" />`
			);
		case 'rect': {
			const s = el.stroke;
			const shape = `<rect x="${n(s / 2)}" y="${n(s / 2)}" width="${n(Math.max(0, el.w - s))}" height="${n(Math.max(0, el.h - s))}" rx="${n(el.radius)}" fill="${el.filled ? '#000' : 'none'}" stroke="${s > 0 ? '#000' : 'none'}" stroke-width="${n(s)}" />`;
			return box(el, svgWrap(el.w, el.h, shape));
		}
		case 'line': {
			const s = el.stroke;
			const shape =
				el.orientation === 'horizontal'
					? `<line x1="0" y1="${n(s / 2)}" x2="${n(el.w)}" y2="${n(s / 2)}" stroke="#000" stroke-width="${n(s)}" />`
					: `<line x1="${n(s / 2)}" y1="0" x2="${n(s / 2)}" y2="${n(el.h)}" stroke="#000" stroke-width="${n(s)}" />`;
			return box(el, svgWrap(el.w, el.h, shape));
		}
	}
}

function svgWrap(w: number, h: number, inner: string): string {
	return `<svg width="100%" height="100%" viewBox="0 0 ${n(w)} ${n(h)}" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">${inner}</svg>`;
}

/** HTML des Etiketten-Dokuments (eine `.page` je PDF-Seite) – exportiert für Tests */
export function buildLabelsHtml(input: LabelPdfInput): { html: string; pages: number } {
	const page = labelPageSize(input.format);
	const placements = placeLabels(input.format, input.labels.length, input.startIndex ?? 0);
	const pages = placements.length ? placements[placements.length - 1]!.page + 1 : 0;
	const perPage: string[][] = Array.from({ length: pages }, () => []);
	placements.forEach((p, i) => {
		const fit = fitLayout(input.layout, p);
		const elements = resolveLayout(input.layout, input.labels[i] ?? {})
			.map(renderElement)
			.join('');
		const outline = input.outlines
			? `<div style="position:absolute;inset:0;outline:0.1mm dashed #999;outline-offset:-0.05mm;"></div>`
			: '';
		perPage[p.page]!.push(
			`<div class="label" style="left:${mm(p.x)};top:${mm(p.y)};width:${mm(p.width)};height:${mm(p.height)};">${outline}<div style="position:absolute;left:${mm(fit.offsetX)};top:${mm(fit.offsetY)};width:${mm(input.layout.widthMm)};height:${mm(input.layout.heightMm)};transform-origin:0 0;transform:scale(${n(fit.scale)});">${elements}</div></div>`
		);
	});
	const body = perPage.map((labels) => `<div class="page">${labels.join('')}</div>`).join('');
	const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'" />
<title>${escapeHtml(input.title)}</title>
<style>
${carlitoFontFaceCss()}
@page { size: ${mm(page.widthMm)} ${mm(page.heightMm)}; margin: 0; }
html, body { margin: 0; padding: 0; }
body { font-family: ${CARLITO_STACK}; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { position: relative; width: ${mm(page.widthMm)}; height: ${mm(page.heightMm)}; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.label { position: absolute; overflow: hidden; }
</style></head>
<body>${body}</body></html>`;
	return { html, pages };
}

/**
 * Etiketten als PDF: Bogen (Raster auf der Seite, Startfeld für angebrochene Bögen) oder Rolle
 * (ein Etikett je Seite in Etikettgröße). Alle Werte werden escaped; Barcodes als Vektor (SVG).
 */
export async function generateLabels(
	ctx: RequestContext,
	input: LabelPdfInput
): Promise<PdfResult> {
	if (ctx.actor.type !== 'system' && !ctx.userId) throw errors.unauthenticated();
	if (!input.title.trim() || input.title.length > 200) {
		throw errors.badRequest('Ungültiger Dokumenttitel');
	}
	if (!input.labels.length) throw errors.badRequest('Keine Etiketten ausgewählt');
	if (input.labels.length > MAX_LABELS) {
		throw errors.badRequest(`Höchstens ${MAX_LABELS} Etiketten auf einmal`);
	}
	const format = labelFormatSchema.safeParse(input.format);
	if (!format.success) throw errors.badRequest('Ungültiges Etikettenformat');
	const layout = labelLayoutSchema.safeParse(input.layout);
	if (!layout.success) throw errors.badRequest('Ungültiges Etikett-Layout');
	for (const values of input.labels) {
		for (const v of Object.values(values)) {
			if (typeof v !== 'string' || v.length > MAX_VALUE_LENGTH) {
				throw errors.badRequest('Ungültiger Etikett-Inhalt');
			}
		}
	}
	const clean: LabelPdfInput = { ...input, format: format.data, layout: layout.data };
	const { html } = buildLabelsHtml(clean);
	const size = labelPageSize(clean.format);
	const buffer = await pdfRenderer()(html, {
		format: 'A4',
		landscape: false,
		pageSizeMm: { width: size.widthMm, height: size.heightMm },
		margins: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
		displayHeaderFooter: false,
		headerTemplate: '<span></span>',
		footerTemplate: '<span></span>'
	});
	return { buffer, contentType: 'application/pdf', fileName: sanitizeFileName(input.title) };
}
