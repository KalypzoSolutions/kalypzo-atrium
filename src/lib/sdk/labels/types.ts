/**
 * Etiketten: Formate (Bogen/Rolle), Layouts aus Elementen in mm und Platzierung auf Seiten.
 * Reine Typen – Client und Server.
 */

export const BARCODE_TYPES = ['qrcode', 'code128', 'datamatrix'] as const;
export type BarcodeType = (typeof BARCODE_TYPES)[number];

export const BARCODE_TYPE_LABELS: Record<BarcodeType, string> = {
	qrcode: 'QR-Code',
	code128: 'Strichcode (Code 128)',
	datamatrix: 'DataMatrix'
};

export const LABEL_LOGOS = ['wappen', 'lilie'] as const;
export type LabelLogo = (typeof LABEL_LOGOS)[number];

export const LABEL_LOGO_LABELS: Record<LabelLogo, string> = { wappen: 'Wappen', lilie: 'Lilie' };

interface LabelElementBase {
	id: string;
	/** Position und Größe in mm, gemessen von der oberen linken Ecke des Etiketts */
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface LabelTextElement extends LabelElementBase {
	type: 'text';
	/** Text mit Platzhaltern wie `{name}` (siehe Felder des Moduls) */
	text: string;
	fontSizePt: number;
	bold: boolean;
	align: 'left' | 'center' | 'right';
	valign: 'top' | 'middle' | 'bottom';
	/** Höchstens so viele Zeilen, Rest wird mit … abgeschnitten (1 = einzeilig) */
	maxLines: number;
}

export interface LabelBarcodeElement extends LabelElementBase {
	type: 'barcode';
	symbology: BarcodeType;
	/** Inhalt mit Platzhaltern, z. B. `{url}` oder `{code}` */
	value: string;
}

export interface LabelImageElement extends LabelElementBase {
	type: 'image';
	logo: LabelLogo;
	/** Schwarz-Weiß statt Farbe (Laser-/Thermodrucker) */
	monochrome?: boolean;
}

export interface LabelRectElement extends LabelElementBase {
	type: 'rect';
	/** Linienstärke in mm (0 = keine Linie) */
	stroke: number;
	radius: number;
	/** Füllung schwarz (für Balken mit weißer Schrift nicht unterstützt – nur Kontur oder Fläche) */
	filled: boolean;
}

export interface LabelLineElement extends LabelElementBase {
	type: 'line';
	stroke: number;
	/** Waagerecht entlang der Oberkante bzw. senkrecht entlang der linken Kante des Rahmens */
	orientation: 'horizontal' | 'vertical';
}

export type LabelElement =
	LabelTextElement | LabelBarcodeElement | LabelImageElement | LabelRectElement | LabelLineElement;

export type LabelElementType = LabelElement['type'];

/** Layout eines Etiketts (Größe in mm, für die es gestaltet wurde) */
export interface LabelLayout {
	widthMm: number;
	heightMm: number;
	elements: LabelElement[];
}

export interface LabelSheetFormat {
	kind: 'sheet';
	pageWidthMm: number;
	pageHeightMm: number;
	cols: number;
	rows: number;
	labelWidthMm: number;
	labelHeightMm: number;
	marginTopMm: number;
	marginLeftMm: number;
	/** Abstand zwischen Spalten bzw. Zeilen */
	gapXMm: number;
	gapYMm: number;
}

export interface LabelRollFormat {
	kind: 'roll';
	labelWidthMm: number;
	labelHeightMm: number;
}

export type LabelFormat = LabelSheetFormat | LabelRollFormat;

export interface LabelFormatPreset {
	key: string;
	name: string;
	format: LabelFormat;
}

/** Ein platziertes Etikett: Seite (ab 0), Position/Größe des Etikettfelds in mm */
export interface LabelPlacement {
	page: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Eingabe für `core.pdf.labels` */
export interface LabelPdfInput {
	title: string;
	format: LabelFormat;
	layout: LabelLayout;
	/** Platzhalter-Werte je Etikett (ein Eintrag = ein Etikett) */
	labels: Record<string, string>[];
	/** Erstes Feld auf dem ersten Bogen (0-basiert, für angebrochene Bögen) */
	startIndex?: number;
	/** Dünne graue Umrisse der Etikettfelder (Probedruck auf Papier) */
	outlines?: boolean;
}
