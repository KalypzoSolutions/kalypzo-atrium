import type {
	LabelElement,
	LabelFormat,
	LabelFormatPreset,
	LabelLayout,
	LabelPlacement
} from './types';

/**
 * Vorgaben für gängige Etiketten. Bögen: Maße laut Herstellerangabe (Avery Zweckform), Ränder so
 * gerechnet, dass das Raster mittig sitzt. Rollen: ein Etikett je PDF-Seite (Etikettendrucker).
 */
export const LABEL_FORMAT_PRESETS: LabelFormatPreset[] = [
	{
		key: 'zweckform-3474',
		name: 'Avery Zweckform 3474 – 70 × 37 mm, 24 je A4',
		format: sheet(3, 8, 70, 37, 0, 0)
	},
	{
		key: 'zweckform-3475',
		name: 'Avery Zweckform 3475 – 70 × 36 mm, 24 je A4',
		format: sheet(3, 8, 70, 36, 0, 0)
	},
	{
		key: 'avery-l7160',
		name: 'Avery L7160 – 63,5 × 38,1 mm, 21 je A4',
		format: sheet(3, 7, 63.5, 38.1, 2.54, 0)
	},
	{
		key: 'avery-l7163',
		name: 'Avery L7163 – 99,1 × 38,1 mm, 14 je A4',
		format: sheet(2, 7, 99.1, 38.1, 2.54, 0)
	},
	{
		key: 'avery-l7651',
		name: 'Avery L7651 – 38,1 × 21,2 mm, 65 je A4',
		format: sheet(5, 13, 38.1, 21.2, 2.54, 0)
	},
	{
		key: 'zweckform-3427',
		name: 'Avery Zweckform 3427 – 105 × 74 mm, 8 je A4',
		format: sheet(2, 4, 105, 74, 0, 0)
	},
	{ key: 'brother-62x29', name: 'Brother DK-11209 – 62 × 29 mm (Rolle)', format: roll(62, 29) },
	{ key: 'brother-62x100', name: 'Brother DK-11202 – 62 × 100 mm (Rolle)', format: roll(62, 100) },
	{ key: 'brother-29x90', name: 'Brother DK-11201 – 90 × 29 mm (Rolle)', format: roll(90, 29) },
	{ key: 'dymo-89x36', name: 'Dymo 99012 – 89 × 36 mm (Rolle)', format: roll(89, 36) },
	{ key: 'dymo-57x32', name: 'Dymo 11354 – 57 × 32 mm (Rolle)', format: roll(57, 32) },
	{ key: 'roll-100x50', name: 'Thermodrucker – 100 × 50 mm (Rolle)', format: roll(100, 50) }
];

function sheet(
	cols: number,
	rows: number,
	w: number,
	h: number,
	gapX: number,
	gapY: number
): LabelFormat {
	const pageWidthMm = 210;
	const pageHeightMm = 297;
	const usedW = cols * w + (cols - 1) * gapX;
	const usedH = rows * h + (rows - 1) * gapY;
	return {
		kind: 'sheet',
		pageWidthMm,
		pageHeightMm,
		cols,
		rows,
		labelWidthMm: w,
		labelHeightMm: h,
		marginLeftMm: round2(Math.max(0, (pageWidthMm - usedW) / 2)),
		marginTopMm: round2(Math.max(0, (pageHeightMm - usedH) / 2)),
		gapXMm: gapX,
		gapYMm: gapY
	};
}

function roll(w: number, h: number): LabelFormat {
	return { kind: 'roll', labelWidthMm: w, labelHeightMm: h };
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Etiketten je Seite (Rolle: 1) */
export function labelsPerPage(format: LabelFormat): number {
	return format.kind === 'roll' ? 1 : format.cols * format.rows;
}

/** Seitengröße in mm */
export function labelPageSize(format: LabelFormat): { widthMm: number; heightMm: number } {
	return format.kind === 'roll'
		? { widthMm: format.labelWidthMm, heightMm: format.labelHeightMm }
		: { widthMm: format.pageWidthMm, heightMm: format.pageHeightMm };
}

/** Größe eines Etikettfelds in mm */
export function labelSize(format: LabelFormat): { widthMm: number; heightMm: number } {
	return { widthMm: format.labelWidthMm, heightMm: format.labelHeightMm };
}

/**
 * Platzierung von `count` Etiketten. Bei Bögen beginnt das erste Etikett im Feld `startIndex`
 * (zeilenweise von links oben gezählt, z. B. für angebrochene Bögen); Rollen ignorieren `startIndex`.
 */
export function placeLabels(format: LabelFormat, count: number, startIndex = 0): LabelPlacement[] {
	const n = Math.max(0, Math.floor(count));
	if (format.kind === 'roll') {
		return Array.from({ length: n }, (_, i) => ({
			page: i,
			x: 0,
			y: 0,
			width: format.labelWidthMm,
			height: format.labelHeightMm
		}));
	}
	const perPage = labelsPerPage(format);
	const start = Math.min(Math.max(0, Math.floor(startIndex)), perPage - 1);
	const out: LabelPlacement[] = [];
	for (let i = 0; i < n; i++) {
		const slot = start + i;
		const page = Math.floor(slot / perPage);
		const inPage = slot % perPage;
		const row = Math.floor(inPage / format.cols);
		const col = inPage % format.cols;
		out.push({
			page,
			x: round2(format.marginLeftMm + col * (format.labelWidthMm + format.gapXMm)),
			y: round2(format.marginTopMm + row * (format.labelHeightMm + format.gapYMm)),
			width: format.labelWidthMm,
			height: format.labelHeightMm
		});
	}
	return out;
}

/** Fehlertext, wenn die Etiketten nicht auf den Bogen passen; sonst `null` */
export function formatProblem(format: LabelFormat): string | null {
	if (format.labelWidthMm <= 0 || format.labelHeightMm <= 0) return 'Etikettgröße fehlt';
	if (format.kind === 'roll') return null;
	const right =
		format.marginLeftMm + format.cols * format.labelWidthMm + (format.cols - 1) * format.gapXMm;
	const bottom =
		format.marginTopMm + format.rows * format.labelHeightMm + (format.rows - 1) * format.gapYMm;
	if (right > format.pageWidthMm + 0.5) return 'Die Etiketten sind breiter als die Seite';
	if (bottom > format.pageHeightMm + 0.5) return 'Die Etiketten sind höher als die Seite';
	return null;
}

/**
 * Skalierung eines Layouts in ein Etikettfeld: gleichmäßig (Seitenverhältnis bleibt), zentriert.
 * Passt das Layout genau, ist `scale` 1 und der Versatz 0.
 */
export function fitLayout(
	layout: Pick<LabelLayout, 'widthMm' | 'heightMm'>,
	box: { width: number; height: number }
): { scale: number; offsetX: number; offsetY: number } {
	if (layout.widthMm <= 0 || layout.heightMm <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
	const scale = Math.min(box.width / layout.widthMm, box.height / layout.heightMm);
	return {
		scale,
		offsetX: (box.width - layout.widthMm * scale) / 2,
		offsetY: (box.height - layout.heightMm * scale) / 2
	};
}

const PLACEHOLDER = /\{([a-z][a-z0-9-]*)\}/g;

/** Ersetzt `{feld}` durch den Wert (unbekannte Felder → leer) */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
	return text.replace(PLACEHOLDER, (_, key: string) => values[key] ?? '');
}

/** Namen der Platzhalter in einem Text */
export function placeholdersIn(text: string): string[] {
	return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]!);
}

/** Elemente mit eingesetzten Werten (Text/Barcode-Inhalt); leere Barcodes fallen weg */
export function resolveLayout(layout: LabelLayout, values: Record<string, string>): LabelElement[] {
	const out: LabelElement[] = [];
	for (const el of layout.elements) {
		if (el.type === 'text') out.push({ ...el, text: fillPlaceholders(el.text, values) });
		else if (el.type === 'barcode') {
			const value = fillPlaceholders(el.value, values).trim();
			if (value) out.push({ ...el, value });
		} else out.push(el);
	}
	return out;
}
