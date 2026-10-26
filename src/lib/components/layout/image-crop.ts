/**
 * Reine Rechenlogik für den Bild-Zuschnitt (`ImageCropDialog`, `FileField crop`).
 *
 * Koordinaten: Der Rahmen ist **1 breit** und `1 / aspect` hoch (Einheit = Rahmenbreite), damit der Zustand
 * unabhängig von der Bildschirmgröße bleibt. `offset` ist die Lage der Bildmitte relativ zur Rahmenmitte,
 * `zoom` ist relativ zum kleinsten Maßstab, bei dem das Bild den Rahmen ganz füllt (1 = passt genau).
 */

export interface Size {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface CropState {
	zoom: number;
	offset: Point;
}

/** Zuschnitt-Optionen für `FileField crop` */
export interface ImageCropOptions {
	/** Seitenverhältnis Breite / Höhe (Standard 1) */
	aspect?: number;
	/** `circle` = runde Maske (Profilbild), Ergebnis quadratisch */
	shape?: 'rect' | 'circle';
	/** Lange Kante des Ergebnisses in Pixeln */
	maxEdge?: number;
	title?: string;
	/** Startfarbe für Ränder beim Herauszoomen und transparente Flächen (Standard Weiß) */
	background?: string | null;
}

export interface DrawRect {
	dx: number;
	dy: number;
	dw: number;
	dh: number;
}

/** Standard-Hintergrund für Ränder und transparente Flächen */
export const DEFAULT_CROP_BACKGROUND = '#ffffff';

/** Größter Zoom über „füllt den Rahmen“ hinaus */
export const MAX_CROP_ZOOM = 5;

/** Größte Originaldatei, die zum Zuschneiden angenommen wird (das Ergebnis ist viel kleiner) */
export const CROP_SOURCE_MAX_BYTES = 25 * 1024 * 1024;

/** Rahmen in Rahmenbreiten für ein Seitenverhältnis (Breite / Höhe) */
export function frameFor(aspect: number): Size {
	const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
	return { width: 1, height: 1 / a };
}

/** Kleinster Maßstab (Rahmeneinheiten je Bildpixel), bei dem das Bild den Rahmen vollständig bedeckt */
export function coverScale(img: Size, frame: Size): number {
	if (img.width <= 0 || img.height <= 0) return 1;
	return Math.max(frame.width / img.width, frame.height / img.height);
}

/**
 * Kleinster Zoom: das ganze Bild halb so groß, wie es „ganz hineinpassend“ wäre (Herauszoomen über das Bild
 * hinaus, Ränder bekommen die Hintergrundfarbe). Quadrat im Quadrat → 0,5; Querformat 2:1 im Quadrat → 0,25.
 */
export function minZoom(img: Size, frame: Size): number {
	if (img.width <= 0 || img.height <= 0) return 1;
	const contain = Math.min(frame.width / img.width, frame.height / img.height);
	return (contain / coverScale(img, frame)) * 0.5;
}

export function clampZoom(zoom: number, min = 1): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.min(MAX_CROP_ZOOM, Math.max(min, zoom));
}

/** Maßstab (Rahmeneinheiten je Bildpixel) beim Zoom `zoom`, begrenzt auf `minZoom` … `MAX_CROP_ZOOM` */
export function scaleAt(img: Size, frame: Size, zoom: number): number {
	return coverScale(img, frame) * clampZoom(zoom, minZoom(img, frame));
}

/** Angezeigte Bildgröße in Rahmeneinheiten */
export function displaySize(img: Size, frame: Size, zoom: number): Size {
	const s = scaleAt(img, frame, zoom);
	return { width: img.width * s, height: img.height * s };
}

/**
 * Verschiebung begrenzen: Ist das Bild größer als der Rahmen, bleibt kein leerer Rand; ist es kleiner
 * (herausgezoomt), bleibt es ganz im Rahmen. Spielraum je Achse = |angezeigt − Rahmen| / 2.
 */
export function clampOffset(offset: Point, img: Size, frame: Size, zoom: number): Point {
	const d = displaySize(img, frame, zoom);
	const mx = Math.abs(d.width - frame.width) / 2;
	const my = Math.abs(d.height - frame.height) / 2;
	// `+ 0` macht aus −0 eine 0
	const fix = (v: number, m: number) => (Number.isFinite(v) ? Math.min(m, Math.max(-m, v)) + 0 : 0);
	return { x: fix(offset.x, mx), y: fix(offset.y, my) };
}

/** Verschieben um `delta` (Rahmeneinheiten) mit Begrenzung */
export function panBy(state: CropState, delta: Point, img: Size, frame: Size): CropState {
	return {
		zoom: state.zoom,
		offset: clampOffset(
			{ x: state.offset.x + delta.x, y: state.offset.y + delta.y },
			img,
			frame,
			state.zoom
		)
	};
}

/**
 * Zoom ändern, sodass der Bildpunkt unter `point` (relativ zur Rahmenmitte) an derselben Stelle bleibt
 * – Mauszeiger, Mitte zweier Finger oder `{ x: 0, y: 0 }` für die Rahmenmitte.
 */
export function zoomAround(
	state: CropState,
	newZoom: number,
	point: Point,
	img: Size,
	frame: Size
): CropState {
	const min = minZoom(img, frame);
	const from = clampZoom(state.zoom, min);
	const to = clampZoom(newZoom, min);
	const k = to / from;
	const offset = {
		x: point.x - (point.x - state.offset.x) * k,
		y: point.y - (point.y - state.offset.y) * k
	};
	return { zoom: to, offset: clampOffset(offset, img, frame, to) };
}

/** Zielmaße des Ergebnisses: lange Kante höchstens `maxEdge`, nie hochskalieren, mindestens 1 px */
export function outputSize(sw: number, sh: number, maxEdge: number): Size {
	const edge = Math.max(sw, sh);
	const scale = edge > 0 && maxEdge > 0 ? Math.min(1, maxEdge / edge) : 1;
	return {
		width: Math.max(1, Math.round(sw * scale)),
		height: Math.max(1, Math.round(sh * scale))
	};
}

/**
 * Ausgabemaße: der Rahmen in Originalpixeln, lange Kante höchstens `maxEdge`. Hineingezoomte Ausschnitte
 * werden nicht hochskaliert; herausgezoomt wächst das Ergebnis höchstens bis `maxEdge`.
 */
export function outputFor(state: CropState, img: Size, frame: Size, maxEdge: number): Size {
	const s = scaleAt(img, frame, state.zoom);
	return outputSize(frame.width / s, frame.height / s, maxEdge);
}

/** Lage des ganzen Bildes in Ausgabepixeln (`drawImage(img, dx, dy, dw, dh)`; das Canvas schneidet ab) */
export function placement(state: CropState, img: Size, frame: Size, out: Size): DrawRect {
	const k = out.width / frame.width;
	const d = displaySize(img, frame, state.zoom);
	const off = clampOffset(state.offset, img, frame, state.zoom);
	return {
		dx: (frame.width / 2 + off.x - d.width / 2) * k,
		dy: (frame.height / 2 + off.y - d.height / 2) * k,
		dw: d.width * k,
		dh: d.height * k
	};
}

/** Dateiname des Ergebnisses: Endung passend zum erzeugten Typ */
export function croppedFileName(original: string, contentType: string): string {
	const ext = contentType === 'image/webp' ? 'webp' : contentType === 'image/png' ? 'png' : 'jpg';
	const base = original.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'bild';
	return `${base}.${ext}`;
}
