import lilieUrl from '../assets/stamm/lilie.png?inline';
import wappenUrl from '../assets/stamm/wappen.png?inline';
import { CARLITO_STACK, carlitoFontFaceCss } from '../fonts';
import {
	baseCss,
	escapeHtml,
	type PdfLayoutData,
	type PdfTemplate,
	type PdfTemplateInput,
	type PdfTemplatePart
} from '../templates';

/**
 * Bausteine des Stamm-Briefkopfs. Alle Maße in mm, gemessen von der oberen linken Ecke der Seite
 * (Referenz: docs/reference/briefkopf_stamm_adressfeld_page_1.png, A4). Die Bausteine sind
 * `position: absolute` und werden von `pageLayer` relativ zur Seitenecke gelegt.
 */

export const PART_IDS = ['briefkopf', 'falzmarken', 'adressfeld', 'fusszeile'] as const;
export type StammPartId = (typeof PART_IDS)[number];

export const PAGE_WIDTH_MM = 210;
export const PAGE_HEIGHT_MM = 297;

export const GEOMETRY = {
	lilie: { x: 13, y: 10.8, width: 13.5, height: 16.8 },
	title: { x: 30.5, y: 18.8, lineHeight: 6.7, sizePt: 13 },
	wappen: { x: 176.7, y: 10.9, width: 20.6, height: 30.5 },
	fold: { x: 5, length: 3, ys: [105, 210] as const },
	address: { x: 25, y: 50.8, width: 84, height: 40, inset: 2.6, insetTop: 1, sizePt: 14 },
	footer: { lineY: 276.8, x: 25, width: 160, textY: 278.8, sizePt: 7 }
} as const;

export const FOOTER_TEXT_LINES = [
	'Die Christliche Pfadfinderschaft Deutschland ist Mitglied der AEJ (Arbeitsgemeinschaft der Evangelischen Jugend in Deutschland e.V.), anerkannt nach §75 SGB',
	'VIII und in das Vereinsregister Heilbad Heiligenstadt unter Nr. 400532 eingetragen.'
];

const mm = (v: number) => `${v}mm`;

/** Briefkopf oben: Lilie, dreizeiliger Vereinsname, Wappen. */
export function letterheadTop(): string {
	const g = GEOMETRY;
	return `<div class="stamm-part" data-part="briefkopf">
<img alt="" src="${lilieUrl}" style="position:absolute;left:${mm(g.lilie.x)};top:${mm(g.lilie.y)};width:${mm(g.lilie.width)};height:${mm(g.lilie.height)};" />
<div style="position:absolute;left:${mm(g.title.x)};top:${mm(g.title.y)};font-family:${CARLITO_STACK};font-size:${g.title.sizePt}pt;line-height:${mm(g.title.lineHeight)};color:#000;white-space:nowrap;">Christliche<br/>Pfadfinderschaft<br/>Deutschlands e.V.</div>
<img alt="" src="${wappenUrl}" style="position:absolute;left:${mm(g.wappen.x)};top:${mm(g.wappen.y)};width:${mm(g.wappen.width)};height:${mm(g.wappen.height)};" />
</div>`;
}

/** Zwei kurze Falzmarken am linken Rand (DIN 5008: 105 mm und 210 mm). */
export function foldMarks(): string {
	const g = GEOMETRY.fold;
	const lines = g.ys
		.map(
			(y) =>
				`<div style="position:absolute;left:${mm(g.x)};top:${mm(y - 0.2)};width:${mm(g.length)};border-top:0.4pt solid #333;height:0;"></div>`
		)
		.join('');
	return `<div class="stamm-part" data-part="falzmarken">${lines}</div>`;
}

/** Adressfenster (84 × 40 mm); Zeilen untereinander, nichts wird gekappt. */
export function addressField(lines: string[] = []): string {
	const g = GEOMETRY.address;
	const body = lines
		.map(
			(line, i) =>
				`<div style="${i === 0 && lines.length > 1 ? 'margin-bottom:3mm;' : ''}">${escapeHtml(line)}</div>`
		)
		.join('');
	return `<div class="stamm-part" data-part="adressfeld" style="position:absolute;left:${mm(g.x)};top:${mm(g.y)};width:${mm(g.width)};height:${mm(g.height)};padding:${mm(g.insetTop)} 0 0 ${mm(g.inset)};font-family:${CARLITO_STACK};font-size:${g.sizePt}pt;line-height:6.9mm;color:#000;overflow:visible;">${body}</div>`;
}

/** Fußzeile: Trennlinie und zentrierter Vereinsnachweis (auf jeder Seite). */
export function letterFooter(): string {
	const g = GEOMETRY.footer;
	return `<div class="stamm-part" data-part="fusszeile">
<div style="position:absolute;left:${mm(g.x - 1)};top:${mm(g.lineY)};width:${mm(g.width + 0.3)};border-top:0.5pt solid #333;height:0;"></div>
<div style="position:absolute;left:${mm(g.x)};top:${mm(g.textY)};width:${mm(g.width)};text-align:center;font-family:${CARLITO_STACK};font-size:${g.sizePt}pt;line-height:3.05mm;color:#222;">${FOOTER_TEXT_LINES.map(escapeHtml).join('<br/>')}</div>
</div>`;
}

/**
 * Legt Bausteine auf eine Ebene mit Ursprung in der oberen linken Seitenecke. `repeat`: fixiert und
 * damit auf jeder Seite (Kopf, Fußzeile); sonst nur auf Seite 1 (Adressfeld, Falzmarken). Die Ebene
 * ist nullgroß, damit sie nicht über Seiten umbrochen wird. `margins` gleicht den Seitenrand aus,
 * relativ zu dem Chromium positionierte Elemente platziert.
 */
export function pageLayer(
	inner: string,
	margins: { left: number; top: number },
	repeat: boolean
): string {
	if (!inner) return '';
	return `<div class="stamm-layer" data-repeat="${repeat}" style="position:${repeat ? 'fixed' : 'absolute'};left:${mm(-margins.left)};top:${mm(-margins.top)};width:0;height:0;overflow:visible;pointer-events:none;">${inner}</div>`;
}

export const PART_META: Record<StammPartId, PdfTemplatePart> = {
	briefkopf: {
		id: 'briefkopf',
		label: 'Briefkopf',
		description: 'Lilie, Vereinsname und Wappen',
		x: GEOMETRY.lilie.x,
		y: GEOMETRY.lilie.y,
		width: GEOMETRY.wappen.x + GEOMETRY.wappen.width - GEOMETRY.lilie.x,
		height: GEOMETRY.wappen.y + GEOMETRY.wappen.height - GEOMETRY.lilie.y
	},
	falzmarken: {
		id: 'falzmarken',
		label: 'Falzmarken',
		description: 'Marken bei 105 mm und 210 mm',
		optional: true,
		x: GEOMETRY.fold.x,
		y: GEOMETRY.fold.ys[0],
		width: GEOMETRY.fold.length,
		height: GEOMETRY.fold.ys[1] - GEOMETRY.fold.ys[0]
	},
	adressfeld: {
		id: 'adressfeld',
		label: 'Adressfeld',
		description: 'Anschriftfenster 84 × 40 mm',
		optional: true,
		x: GEOMETRY.address.x,
		y: GEOMETRY.address.y,
		width: GEOMETRY.address.width,
		height: GEOMETRY.address.height
	},
	fusszeile: {
		id: 'fusszeile',
		label: 'Fußzeile',
		description: 'Trennlinie und Vereinsnachweis, auf jeder Seite',
		x: GEOMETRY.footer.x,
		y: GEOMETRY.footer.lineY,
		width: GEOMETRY.footer.width,
		height: 9
	}
};

/**
 * Seitenrand des Textes. Chromium-Seitenränder sind 0: fixierte Elemente im Randbereich würden von
 * Chromium sonst über Seiten umbrochen (Kopf auf Seite 1, Fußzeile erst auf Seite 2). Der Rand
 * entsteht stattdessen über eine Tabelle mit wiederholtem Kopf-/Fußabstand (siehe `flowOpen`).
 */
const STAMM_MARGINS = { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' };
const ORIGIN_MM = { left: 0, top: 0 };
const TEXT_MARGIN_MM = { top: 45, right: 25, bottom: 25, left: 25 };

/**
 * Öffnet den Textfluss: Tabelle, deren `thead`/`tfoot` auf jeder Seite den oberen/unteren Rand
 * reservieren. Bewusst nicht geschlossen; der HTML-Parser schließt sie am Dokumentende.
 */
function flowOpen(): string {
	const m = TEXT_MARGIN_MM;
	return `<table class="stamm-flow"><thead><tr><td style="height:${mm(m.top)}"></td></tr></thead><tfoot><tr><td style="height:${mm(m.bottom)}"></td></tr></tfoot><tbody><tr><td class="stamm-text">`;
}
/** Der Text beginnt auf Seite 1 bei ca. 108 mm (Seitenrand oben 45 mm). */
const TEXT_START_MM = 108;

/** Gemeinsamer Aufbau der Stamm-Vorlagen; `withAddress` schaltet Falzmarken und Adressfeld zu. */
export function createStammTemplate(options: {
	id: string;
	label: string;
	description: string;
	source: string;
	withAddress: boolean;
}): PdfTemplate {
	const ids: StammPartId[] = options.withAddress
		? ['briefkopf', 'falzmarken', 'adressfeld', 'fusszeile']
		: ['briefkopf', 'fusszeile'];
	return {
		id: options.id,
		label: options.label,
		description: options.description,
		source: options.source,
		parts: ids.map((id) => PART_META[id]),
		page: { format: 'A4', margins: STAMM_MARGINS },
		css: (d: PdfLayoutData) =>
			carlitoFontFaceCss() +
			baseCss(d, '11pt') +
			`body { font-family: ${CARLITO_STACK}; }
			.stamm-flow { border-collapse: collapse; width: 100%; margin: 0; }
			.stamm-flow td { border: 0; background: none; padding: 0; }
			.stamm-flow td.stamm-text { padding: 0 ${mm(TEXT_MARGIN_MM.right)} 0 ${mm(TEXT_MARGIN_MM.left)}; }
			h1, h2, h3 { color: #111827; }
			h1 { font-size: 1.3em; font-weight: 700; margin: 1.4em 0 .7em; }
				h1.doc-title { margin: 0 0 .9em; }
				h2 { font-size: 1.15em; font-weight: 700; margin: 1.5em 0 .5em; }
				h3 { font-size: 1em; font-weight: 700; margin: 1.2em 0 .4em; }`,
		header: () => '<span></span>',
		footer: () => '<span></span>',
		overlay: (_d: PdfLayoutData, input?: PdfTemplateInput) => {
			const only = input?.only;
			const show = (id: StammPartId) => ids.includes(id) && (!only || only === id);
			// Kopf und Fußzeile auf jeder Seite; Falzmarken und Adressfeld nur auf Seite 1.
			let everyPage = '';
			let firstPage = '';
			if (show('briefkopf')) everyPage += letterheadTop();
			if (show('fusszeile')) everyPage += letterFooter();
			if (show('falzmarken')) firstPage += foldMarks();
			if (show('adressfeld')) firstPage += addressField(input?.recipient ?? []);
			return (
				flowOpen() + pageLayer(everyPage, ORIGIN_MM, true) + pageLayer(firstPage, ORIGIN_MM, false)
			);
		},
		titleBlock: (d: PdfLayoutData) => {
			const spacer = options.withAddress
				? `<div style="height:${TEXT_START_MM - TEXT_MARGIN_MM.top}mm;"></div>`
				: '';
			return `${spacer}<h1 class="doc-title">${escapeHtml(d.title)}</h1>`;
		}
	};
}
