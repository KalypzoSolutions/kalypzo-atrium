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
}

export interface SourceRect {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
}

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

export function clampZoom(zoom: number): number {
	if (!Number.isFinite(zoom)) return 1;
	return Math.min(MAX_CROP_ZOOM, Math.max(1, zoom));
}

/** Angezeigte Bildgröße in Rahmeneinheiten */
export function displaySize(img: Size, frame: Size, zoom: number): Size {
	const s = coverScale(img, frame) * clampZoom(zoom);
	return { width: img.width * s, height: img.height * s };
}

/** Verschiebung begrenzen, sodass das Bild den Rahmen immer ganz füllt (keine leeren Ränder) */
export function clampOffset(offset: Point, img: Size, frame: Size, zoom: number): Point {
	const d = displaySize(img, frame, zoom);
	const mx = Math.max(0, (d.width - frame.width) / 2);
	const my = Math.max(0, (d.height - frame.height) / 2);
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
	const from = clampZoom(state.zoom);
	const to = clampZoom(newZoom);
	const k = to / from;
	const offset = {
		x: point.x - (point.x - state.offset.x) * k,
		y: point.y - (point.y - state.offset.y) * k
	};
	return { zoom: to, offset: clampOffset(offset, img, frame, to) };
}

/** Sichtbarer Ausschnitt in Originalpixeln (für `drawImage`) */
export function sourceRect(state: CropState, img: Size, frame: Size): SourceRect {
	const s = coverScale(img, frame) * clampZoom(state.zoom);
	const off = clampOffset(state.offset, img, frame, state.zoom);
	const sw = Math.min(img.width, frame.width / s);
	const sh = Math.min(img.height, frame.height / s);
	const sx = img.width / 2 - off.x / s - sw / 2;
	const sy = img.height / 2 - off.y / s - sh / 2;
	return {
		sx: Math.min(img.width - sw, Math.max(0, sx)),
		sy: Math.min(img.height - sh, Math.max(0, sy)),
		sw,
		sh
	};
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

/** Dateiname des Ergebnisses: Endung passend zum erzeugten Typ */
export function croppedFileName(original: string, contentType: string): string {
	const ext = contentType === 'image/webp' ? 'webp' : contentType === 'image/png' ? 'png' : 'jpg';
	const base = original.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim() || 'bild';
	return `${base}.${ext}`;
}
