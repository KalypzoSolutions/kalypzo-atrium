import { describe, expect, it } from 'vitest';
import {
	MAX_CROP_ZOOM,
	clampOffset,
	coverScale,
	croppedFileName,
	frameFor,
	outputSize,
	panBy,
	sourceRect,
	zoomAround
} from '$lib/components/layout/image-crop';

const square = frameFor(1);
const landscape = { width: 2000, height: 1000 };
const portrait = { width: 600, height: 1200 };

describe('coverScale', () => {
	it('Querformat im Quadrat: Höhe füllt den Rahmen', () => {
		// 1 / 1000 (Höhe) > 1 / 2000 (Breite)
		expect(coverScale(landscape, square)).toBeCloseTo(1 / 1000);
	});
	it('Hochformat im Quadrat: Breite füllt den Rahmen', () => {
		expect(coverScale(portrait, square)).toBeCloseTo(1 / 600);
	});
	it('Breiter Rahmen 2:1 mit Hochformat', () => {
		const frame = frameFor(2); // 1 × 0,5
		expect(coverScale(portrait, frame)).toBeCloseTo(1 / 600);
	});
	it('leeres Bild → 1, ungültiges Seitenverhältnis → Quadrat', () => {
		expect(coverScale({ width: 0, height: 0 }, square)).toBe(1);
		expect(frameFor(0)).toEqual({ width: 1, height: 1 });
		expect(frameFor(Number.NaN)).toEqual({ width: 1, height: 1 });
	});
});

describe('clampOffset', () => {
	it('Querformat: waagerecht bis ±0,5 verschiebbar, senkrecht gar nicht', () => {
		// angezeigt 2 × 1 Rahmen → Spielraum (2 − 1) / 2 = 0,5
		expect(clampOffset({ x: 3, y: 3 }, landscape, square, 1)).toEqual({ x: 0.5, y: 0 });
		expect(clampOffset({ x: -3, y: -3 }, landscape, square, 1)).toEqual({ x: -0.5, y: 0 });
	});
	it('Zoom 2 vergrößert den Spielraum', () => {
		// angezeigt 4 × 2 → x ±1,5, y ±0,5
		expect(clampOffset({ x: 9, y: -9 }, landscape, square, 2)).toEqual({ x: 1.5, y: -0.5 });
	});
	it('NaN wird zu 0', () => {
		expect(clampOffset({ x: Number.NaN, y: 0.1 }, landscape, square, 1)).toEqual({ x: 0, y: 0 });
	});
});

describe('zoomAround', () => {
	it('Zoom um die Mitte behält die Mitte', () => {
		const s = zoomAround({ zoom: 1, offset: { x: 0, y: 0 } }, 2, { x: 0, y: 0 }, landscape, square);
		expect(s).toEqual({ zoom: 2, offset: { x: 0, y: 0 } });
	});
	it('Punkt unter dem Zeiger bleibt stehen', () => {
		const start = { zoom: 1, offset: { x: 0, y: 0 } };
		const p = { x: 0.25, y: 0.25 };
		const s = zoomAround(start, 2, p, landscape, square);
		// (p − off) / Zoom bleibt gleich: 0,25 / 1 = (0,25 − off') / 2 → off' = −0,25
		expect(s.offset.x).toBeCloseTo(-0.25);
		expect(s.offset.y).toBeCloseTo(-0.25);
	});
	it('Zoom wird auf 1 … MAX begrenzt und Verschiebung nachgezogen', () => {
		const zoomed = { zoom: 3, offset: { x: 2, y: 1 } };
		const out = zoomAround(zoomed, 0.2, { x: 0, y: 0 }, landscape, square);
		expect(out.zoom).toBe(1);
		expect(out.offset).toEqual({ x: 0.5, y: 0 });
		expect(zoomAround(zoomed, 99, { x: 0, y: 0 }, landscape, square).zoom).toBe(MAX_CROP_ZOOM);
	});
});

describe('panBy', () => {
	it('summiert und begrenzt', () => {
		const s = panBy({ zoom: 1, offset: { x: 0.4, y: 0 } }, { x: 0.3, y: 0.3 }, landscape, square);
		expect(s.offset).toEqual({ x: 0.5, y: 0 });
	});
});

describe('sourceRect', () => {
	it('Mitte des Querformats ohne Zoom = mittleres Quadrat', () => {
		const r = sourceRect({ zoom: 1, offset: { x: 0, y: 0 } }, landscape, square);
		expect(r.sw).toBeCloseTo(1000);
		expect(r.sh).toBeCloseTo(1000);
		expect(r.sx).toBeCloseTo(500);
		expect(r.sy).toBeCloseTo(0);
	});
	it('Bild ganz nach rechts geschoben zeigt die linke Kante', () => {
		const r = sourceRect({ zoom: 1, offset: { x: 0.5, y: 0 } }, landscape, square);
		expect(r.sx).toBeCloseTo(0);
	});
	it('Bild ganz nach links geschoben zeigt die rechte Kante', () => {
		const r = sourceRect({ zoom: 1, offset: { x: -0.5, y: 0 } }, landscape, square);
		expect(r.sx + r.sw).toBeCloseTo(2000);
	});
	it('maximaler Zoom in der Ecke bleibt im Bild', () => {
		const r = sourceRect({ zoom: MAX_CROP_ZOOM, offset: { x: 99, y: 99 } }, landscape, square);
		expect(r.sw).toBeCloseTo(1000 / MAX_CROP_ZOOM);
		expect(r.sx).toBeCloseTo(0);
		expect(r.sy).toBeCloseTo(0);
	});
	it('2:1-Rahmen über Hochformat: volle Breite, halbe Breite hoch', () => {
		const r = sourceRect({ zoom: 1, offset: { x: 0, y: 0 } }, portrait, frameFor(2));
		expect(r.sw).toBeCloseTo(600);
		expect(r.sh).toBeCloseTo(300);
		expect(r.sy).toBeCloseTo(450);
	});
});

describe('outputSize', () => {
	it('verkleinert auf die lange Kante', () => {
		expect(outputSize(1000, 1000, 512)).toEqual({ width: 512, height: 512 });
		expect(outputSize(1200, 600, 600)).toEqual({ width: 600, height: 300 });
	});
	it('skaliert kleine Ausschnitte nicht hoch', () => {
		expect(outputSize(200, 200, 1200)).toEqual({ width: 200, height: 200 });
	});
	it('mindestens 1 px, ungültige Grenze → unverändert', () => {
		expect(outputSize(0.2, 0.2, 512)).toEqual({ width: 1, height: 1 });
		expect(outputSize(300, 150, 0)).toEqual({ width: 300, height: 150 });
	});
});

describe('croppedFileName', () => {
	it('ersetzt die Endung passend zum Typ', () => {
		expect(croppedFileName('Foto 1.HEIC.jpeg', 'image/webp')).toBe('Foto 1.HEIC.webp');
		expect(croppedFileName('bild.png', 'image/jpeg')).toBe('bild.jpg');
		expect(croppedFileName('.png', 'image/png')).toBe('bild.png');
	});
});
