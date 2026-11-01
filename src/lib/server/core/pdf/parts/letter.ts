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
 * Bausteine eines Briefes nach DIN 5008 (Briefkopf, Falzmarken, Adressfeld, Fußzeile). Alle Maße in mm,
 * gemessen von der oberen linken Ecke der Seite (A4). Die Bausteine sind `position: absolute` und werden von
 * `pageLayer` relativ zur Seitenecke gelegt.
 *
 * Der Core zeichnet einen **neutralen Kopf** (Logo rechts, Name der Organisation links); Module liefern über
 * `letterhead` einen eigenen Kopf und eigene Fußzeilenzeilen (z. B. ein Profil-Modul einer Organisation).
 */

export const PART_IDS = ['briefkopf', 'falzmarken', 'adressfeld', 'fusszeile'] as const;
export type LetterPartId = (typeof PART_IDS)[number];

export const GEOMETRY = {
	/** Bildmarke links neben dem Namen (nur Kopf aus Modulen) */
	mark: { x: 13, y: 10.8, width: 13.5, height: 16.8 },
	title: { x: 30.5, y: 18.8, lineHeight: 6.7, sizePt: 13 },
	/** Logo bzw. Emblem rechts */
	emblem: { x: 176.7, y: 10.9, width: 20.6, height: 30.5 },
	fold: { x: 5, length: 3, ys: [105, 210] as const },
	address: { x: 25, y: 50.8, width: 84, height: 40, inset: 2.6, insetTop: 1, sizePt: 14 },
	footer: { lineY: 276.8, x: 25, width: 160, textY: 278.8, sizePt: 7 }
} as const;

export type LetterOrientation = 'portrait' | 'landscape';

interface Box {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** Geometrie der Bausteine, die beide Ausrichtungen gemeinsam haben (ohne Falzmarken/Adressfeld). */
export interface LetterGeometry {
	readonly mark: Box;
	readonly title: {
		readonly x: number;
		readonly y: number;
		readonly lineHeight: number;
		readonly sizePt: number;
	};
	readonly emblem: Box;
	readonly footer: {
		readonly lineY: number;
		readonly x: number;
		readonly width: number;
		readonly textY: number;
		readonly sizePt: number;
	};
	/** `true`: Fußzeilentext als ein zentrierter Absatz statt fester Zeilen. */
	readonly footerFlow: boolean;
	/** Textränder in mm (Tabelle in `flowOpen` und Zellabstand). */
	readonly textMargin: {
		readonly top: number;
		readonly right: number;
		readonly bottom: number;
		readonly left: number;
	};
}

/** Textränder in mm, in beiden Ausrichtungen gleich. */
const TEXT_MARGIN = { top: 45, right: 25, bottom: 25, left: 25 } as const;

/**
 * Quer (A4 297 × 210 mm): Bildmarke und Name wie hochkant; Emblem mit demselben Abstand zum rechten Rand
 * (12,7 mm); Fußzeile 25 mm Rand links/rechts, 20,2 mm über der Unterkante.
 */
export const GEOMETRY_LANDSCAPE = {
	mark: GEOMETRY.mark,
	title: GEOMETRY.title,
	emblem: { x: 263.7, y: 10.9, width: 20.6, height: 30.5 },
	footer: { lineY: 189.8, x: 25, width: 247, textY: 191.8, sizePt: 7 },
	footerFlow: true,
	textMargin: TEXT_MARGIN
} as const satisfies LetterGeometry;

const GEOMETRY_PORTRAIT = {
	mark: GEOMETRY.mark,
	title: GEOMETRY.title,
	emblem: GEOMETRY.emblem,
	footer: GEOMETRY.footer,
	footerFlow: false,
	textMargin: TEXT_MARGIN
} as const satisfies LetterGeometry;

/** Geometrie je Ausrichtung (hochkant = `GEOMETRY`). */
export function letterGeometry(orientation: LetterOrientation = 'portrait'): LetterGeometry {
	return orientation === 'landscape' ? GEOMETRY_LANDSCAPE : GEOMETRY_PORTRAIT;
}

/**
 * Eigener Briefkopf eines Moduls. `top` liefert absolut positioniertes HTML (Ursprung obere linke Seitenecke,
 * Maße aus `geo`); den Rahmen `data-part="briefkopf"` setzt der Core. Nutzereingaben immer mit `escapeHtml`.
 */
export interface LetterheadSpec {
	top(geo: LetterGeometry, data: PdfLayoutData): string;
	/** Zeilen der Fußzeile (hochkant untereinander, quer als ein Absatz); ohne Angabe die des Core */
	footerLines?(data: PdfLayoutData): string[];
	/** Beschreibung der Bestandteile in der Verwaltung (Standard: die des neutralen Kopfes) */
	headDescription?: string;
	footerDescription?: string;
}

const mm = (v: number) => `${v}mm`;

/** Inhalt der Box `data-part="briefkopf"` */
function headWrap(inner: string): string {
	return `<div class="letter-part" data-part="briefkopf">\n${inner}\n</div>`;
}

/** Neutraler Kopf: Name der Organisation an der Titelposition, Logo (falls vorhanden) rechts. */
export function neutralLetterheadTop(
	g: LetterGeometry = GEOMETRY_PORTRAIT,
	data?: Pick<PdfLayoutData, 'organization' | 'logoDataUrl'>
): string {
	const name = data?.organization.name.trim() ?? '';
	const title = name
		? `<div style="position:absolute;left:${mm(g.title.x)};top:${mm(g.title.y)};font-family:${CARLITO_STACK};font-size:${g.title.sizePt}pt;line-height:${mm(g.title.lineHeight)};font-weight:700;color:#000;white-space:nowrap;">${escapeHtml(name)}</div>`
		: '';
	const logo = data?.logoDataUrl
		? `<img alt="" src="${escapeHtml(data.logoDataUrl)}" style="position:absolute;left:${mm(g.emblem.x)};top:${mm(g.emblem.y)};width:${mm(g.emblem.width)};height:${mm(g.emblem.height)};object-fit:contain;object-position:right top;" />`
		: '';
	return headWrap(title + logo);
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
	return `<div class="letter-part" data-part="falzmarken">${lines}</div>`;
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
	return `<div class="letter-part" data-part="adressfeld" style="position:absolute;left:${mm(g.x)};top:${mm(g.y)};width:${mm(g.width)};height:${mm(g.height)};padding:${mm(g.insetTop)} 0 0 ${mm(g.inset)};font-family:${CARLITO_STACK};font-size:${g.sizePt}pt;line-height:6.9mm;color:#000;overflow:visible;">${body}</div>`;
}

/**
 * Fußzeilenzeilen des Core: Text aus `core.pdf.footerText` (Zeilen wie eingegeben), sonst Anschrift, E-Mail und
 * Telefon der Organisation in einer Zeile.
 */
export function neutralFooterLines(
	data: Pick<PdfLayoutData, 'footerText' | 'organization'>
): string[] {
	const own = data.footerText
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	if (own.length) return own.slice(0, 3);
	const o = data.organization;
	const line = [o.address.replace(/\s*\r?\n\s*/g, ', '), o.email, o.phone]
		.map((s) => s.trim())
		.filter(Boolean)
		.join(' · ');
	return line ? [line] : [];
}

/** Fußzeile: Trennlinie und zentrierter Text (auf jeder Seite). */
export function letterFooter(
	geo: LetterGeometry = GEOMETRY_PORTRAIT,
	lines: string[] = []
): string {
	const g = geo.footer;
	// Quer: ein Absatz, den der Browser zentriert umbricht; hochkant: feste Zeilen.
	const text = geo.footerFlow ? escapeHtml(lines.join(' ')) : lines.map(escapeHtml).join('<br/>');
	return `<div class="letter-part" data-part="fusszeile">
<div style="position:absolute;left:${mm(g.x - 1)};top:${mm(g.lineY)};width:${mm(g.width + 0.3)};border-top:0.5pt solid #333;height:0;"></div>
<div style="position:absolute;left:${mm(g.x)};top:${mm(g.textY)};width:${mm(g.width)};text-align:center;font-family:${CARLITO_STACK};font-size:${g.sizePt}pt;line-height:3.05mm;color:#222;">${text}</div>
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
	return `<div class="letter-layer" data-repeat="${repeat}" style="position:${repeat ? 'fixed' : 'absolute'};left:${mm(-margins.left)};top:${mm(-margins.top)};width:0;height:0;overflow:visible;pointer-events:none;">${inner}</div>`;
}

/** Bestandteile, die beide Ausrichtungen haben. */
type SharedPartId = 'briefkopf' | 'fusszeile';
const SHARED_PART_IDS = ['briefkopf', 'fusszeile'] as const satisfies readonly SharedPartId[];

/**
 * Bezeichnungen der Bestandteile sind Textschlüssel (`pdf.parts.*`); die Verwaltung übersetzt sie beim Anzeigen
 * (`localizeTemplateText`). Module dürfen eigene, fertige Texte angeben.
 */
function sharedParts(
	g: LetterGeometry,
	head = 'pdf.parts.briefkopf.description',
	foot = 'pdf.parts.fusszeile.description'
): Record<SharedPartId, PdfTemplatePart> {
	return {
		briefkopf: {
			id: 'briefkopf',
			label: 'pdf.parts.briefkopf.label',
			description: head,
			x: g.mark.x,
			y: g.mark.y,
			width: g.emblem.x + g.emblem.width - g.mark.x,
			height: g.emblem.y + g.emblem.height - g.mark.y
		},
		fusszeile: {
			id: 'fusszeile',
			label: 'pdf.parts.fusszeile.label',
			description: foot,
			x: g.footer.x,
			y: g.footer.lineY,
			width: g.footer.width,
			height: 9
		}
	};
}

/** Bestandteile quer (nur Briefkopf und Fußzeile; Fensterumschlag gibt es nur hochkant). */
export const PART_META_LANDSCAPE = sharedParts(GEOMETRY_LANDSCAPE);

const PORTRAIT_SHARED = sharedParts(GEOMETRY_PORTRAIT);

const FOLD_PART: PdfTemplatePart = {
	id: 'falzmarken',
	label: 'pdf.parts.falzmarken.label',
	description: 'pdf.parts.falzmarken.description',
	optional: true,
	x: GEOMETRY.fold.x,
	y: GEOMETRY.fold.ys[0],
	width: GEOMETRY.fold.length,
	height: GEOMETRY.fold.ys[1] - GEOMETRY.fold.ys[0]
};

const ADDRESS_PART: PdfTemplatePart = {
	id: 'adressfeld',
	label: 'pdf.parts.adressfeld.label',
	description: 'pdf.parts.adressfeld.description',
	optional: true,
	x: GEOMETRY.address.x,
	y: GEOMETRY.address.y,
	width: GEOMETRY.address.width,
	height: GEOMETRY.address.height
};

export const PART_META: Record<LetterPartId, PdfTemplatePart> = {
	briefkopf: PORTRAIT_SHARED.briefkopf,
	falzmarken: FOLD_PART,
	adressfeld: ADDRESS_PART,
	fusszeile: PORTRAIT_SHARED.fusszeile
};

/**
 * Seitenrand des Textes. Chromium-Seitenränder sind 0: fixierte Elemente im Randbereich würden von
 * Chromium sonst über Seiten umbrochen (Kopf auf Seite 1, Fußzeile erst auf Seite 2). Der Rand
 * entsteht stattdessen über eine Tabelle mit wiederholtem Kopf-/Fußabstand (siehe `flowOpen`).
 */
const LETTER_MARGINS = { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' };
const ORIGIN_MM = { left: 0, top: 0 };

/**
 * Öffnet den Textfluss: Tabelle, deren `thead`/`tfoot` auf jeder Seite den oberen/unteren Rand
 * reservieren. Bewusst nicht geschlossen; der HTML-Parser schließt sie am Dokumentende.
 */
function flowOpen(m: LetterGeometry['textMargin']): string {
	return `<table class="letter-flow"><thead><tr><td class="letter-gap" style="height:${mm(m.top)}"></td></tr></thead><tfoot><tr><td class="letter-gap" style="height:${mm(m.bottom)}"></td></tr></tfoot><tbody><tr><td class="letter-text">`;
}
/** Der Text beginnt auf Seite 1 bei ca. 108 mm (Seitenrand oben 45 mm). */
const TEXT_START_MM = 108;

export interface LetterTemplateOptions {
	id: string;
	/** Name in der Verwaltung (Text oder Textschlüssel) */
	label: string;
	description: string;
	/** Quelldatei (nur Anzeige), z. B. `templates/brief.ts` */
	source: string;
	/** Falzmarken und Adressfeld (Fensterumschlag, nur hochkant) */
	withAddress: boolean;
	orientation?: LetterOrientation;
	/** Eigener Kopf/eigene Fußzeile (sonst neutral aus Logo, Name und Kontaktdaten der Organisation) */
	letterhead?: LetterheadSpec;
}

/**
 * Gemeinsamer Aufbau der Briefvorlagen; `withAddress` schaltet Falzmarken und Adressfeld zu,
 * `orientation` wählt hochkant (Standard) oder quer. Quer gibt es nur ohne Adressfeld.
 */
export function createLetterTemplate(options: LetterTemplateOptions): PdfTemplate {
	const orientation = options.orientation ?? 'portrait';
	if (orientation === 'landscape' && options.withAddress) {
		throw new Error('Briefvorlage: Adressfeld (Fensterumschlag) gibt es nur hochkant.');
	}
	const geo = letterGeometry(orientation);
	const margin = geo.textMargin;
	const head = options.letterhead;
	const ids: readonly LetterPartId[] = options.withAddress ? PART_IDS : SHARED_PART_IDS;
	const shared = sharedParts(geo, head?.headDescription, head?.footerDescription);
	const parts = ids.map((id) =>
		id === 'briefkopf' || id === 'fusszeile' ? shared[id] : PART_META[id]
	);
	return {
		id: options.id,
		label: options.label,
		description: options.description,
		source: options.source,
		parts,
		page: { format: 'A4', orientation, margins: LETTER_MARGINS },
		css: (d: PdfLayoutData) =>
			carlitoFontFaceCss() +
			baseCss(d, '11pt') +
			`body { font-family: ${CARLITO_STACK}; }
			.letter-flow { border-collapse: collapse; width: 100%; margin: 0; }
			.letter-flow > thead > tr > td.letter-gap,
			.letter-flow > tfoot > tr > td.letter-gap,
			.letter-flow > tbody > tr > td.letter-text { border: 0; background: none; padding: 0; }
			.letter-flow > tbody > tr > td.letter-text { padding: 0 ${mm(margin.right)} 0 ${mm(margin.left)}; }
			h1, h2, h3 { color: #111827; }
			h1 { font-size: 1.3em; font-weight: 700; margin: 1.4em 0 .7em; }
				h1.doc-title { margin: 0 0 .9em; }
				h2 { font-size: 1.15em; font-weight: 700; margin: 1.5em 0 .5em; }
				h3 { font-size: 1em; font-weight: 700; margin: 1.2em 0 .4em; }`,
		header: () => '<span></span>',
		footer: () => '<span></span>',
		overlay: (d: PdfLayoutData, input?: PdfTemplateInput) => {
			const only = input?.only;
			const show = (id: LetterPartId) => ids.includes(id) && (!only || only === id);
			// Kopf und Fußzeile auf jeder Seite; Falzmarken und Adressfeld nur auf Seite 1.
			let everyPage = '';
			let firstPage = '';
			if (show('briefkopf')) {
				everyPage += head ? headWrap(head.top(geo, d)) : neutralLetterheadTop(geo, d);
			}
			if (show('fusszeile')) {
				everyPage += letterFooter(geo, head?.footerLines?.(d) ?? neutralFooterLines(d));
			}
			if (show('falzmarken')) firstPage += foldMarks();
			if (show('adressfeld')) firstPage += addressField(input?.recipient ?? []);
			return (
				flowOpen(margin) +
				pageLayer(everyPage, ORIGIN_MM, true) +
				pageLayer(firstPage, ORIGIN_MM, false)
			);
		},
		titleBlock: (d: PdfLayoutData) => {
			const spacer = options.withAddress
				? `<div style="height:${TEXT_START_MM - margin.top}mm;"></div>`
				: '';
			return `${spacer}<h1 class="doc-title">${escapeHtml(d.title)}</h1>`;
		}
	};
}
