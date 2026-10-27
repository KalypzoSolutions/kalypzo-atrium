import { describe, expect, it } from 'vitest';
import { labelLayoutSchema, type LabelLayout } from '$lib/sdk/labels';
import {
	createElement,
	createHistory,
	duplicateElement,
	HISTORY_MERGE_MS,
	moveBox,
	nudge,
	overflowing,
	pushHistory,
	redoHistory,
	reorder,
	resizeBox,
	sampleValues,
	scaleLayout,
	snap,
	undoHistory
} from '$lib/modules/material/pages/labels/designer';
import { LABEL_STARTERS, starterLayout } from '$lib/modules/material/pages/labels/starters';
import { LABEL_FORMAT_PRESETS } from '$lib/sdk/labels';

const bounds = { width: 70, height: 37 };

describe('Etiketten-Designer: Einrasten und Verschieben', () => {
	it('rastet auf 0,5 und 1 mm ein, ohne Raster nur gerundet', () => {
		expect(snap(3.26, 0.5)).toBe(3.5);
		expect(snap(3.24, 0.5)).toBe(3);
		expect(snap(3.5, 1)).toBe(4);
		expect(snap(3.456, 0)).toBe(3.46);
		expect(snap(Number.NaN, 1)).toBe(0);
	});

	it('hält Elemente beim Verschieben im Etikett', () => {
		const box = { x: 10, y: 10, w: 20, h: 10 };
		expect(moveBox(box, 3.3, -1.2, { step: 1, bounds })).toEqual({ x: 13, y: 9, w: 20, h: 10 });
		expect(moveBox(box, 100, 100, { step: 1, bounds })).toEqual({ x: 50, y: 27, w: 20, h: 10 });
		expect(moveBox(box, -100, -100, { step: 0.5, bounds })).toEqual({ x: 0, y: 0, w: 20, h: 10 });
	});

	it('Pfeiltasten verschieben um den Schritt, unbekannte Tasten nicht', () => {
		const box = { x: 10.25, y: 5, w: 5, h: 5 };
		expect(nudge(box, 'ArrowRight', 0.5, bounds)).toEqual({ x: 10.75, y: 5, w: 5, h: 5 });
		expect(nudge(box, 'ArrowUp', 0, bounds)).toEqual({ x: 10.25, y: 4.5, w: 5, h: 5 });
		expect(nudge(box, 'a', 1, bounds)).toBeNull();
	});
});

describe('Etiketten-Designer: Größe per Griffen', () => {
	const box = { x: 10, y: 10, w: 20, h: 10 };

	it('Ost-/Süd-Griff ändern nur Breite/Höhe, Nordwest verschiebt die Ecke', () => {
		expect(resizeBox(box, 'e', 4.2, 0, { step: 1, bounds })).toEqual({
			x: 10,
			y: 10,
			w: 24,
			h: 10
		});
		expect(resizeBox(box, 's', 0, 2.6, { step: 0.5, bounds })).toEqual({
			x: 10,
			y: 10,
			w: 20,
			h: 12.5
		});
		expect(resizeBox(box, 'nw', -3, -2, { step: 1, bounds })).toEqual({ x: 7, y: 8, w: 23, h: 12 });
	});

	it('Mindestgröße 1 mm und Etikettgrenzen', () => {
		expect(resizeBox(box, 'e', -50, 0, { step: 1, bounds }).w).toBe(1);
		expect(resizeBox(box, 'w', 50, 0, { step: 1, bounds })).toMatchObject({ x: 29, w: 1 });
		expect(resizeBox(box, 'se', 100, 100, { step: 1, bounds })).toEqual({
			x: 10,
			y: 10,
			w: 60,
			h: 27
		});
		expect(resizeBox(box, 'nw', -100, -100, { step: 1, bounds })).toEqual({
			x: 0,
			y: 0,
			w: 30,
			h: 20
		});
	});

	it('hält bei Ecken auf Wunsch das Seitenverhältnis (QR-Code)', () => {
		const qr = { x: 2, y: 2, w: 10, h: 10 };
		const r = resizeBox(qr, 'se', 6, 1, { step: 0, bounds, keepAspect: true });
		expect(r.w).toBe(r.h);
		expect(r.w).toBe(16);
		const big = resizeBox(qr, 'se', 100, 100, { step: 0, bounds, keepAspect: true });
		expect(big.w).toBe(big.h);
		expect(big.y + big.h).toBeLessThanOrEqual(37);
	});
});

describe('Etiketten-Designer: Mitskalieren und Ebenen', () => {
	const layout: LabelLayout = {
		widthMm: 70,
		heightMm: 37,
		elements: [
			{
				id: 't',
				type: 'text',
				x: 35,
				y: 10,
				w: 30,
				h: 10,
				text: '{name}',
				fontSizePt: 12,
				bold: true,
				align: 'left',
				valign: 'top',
				maxLines: 2
			},
			{ id: 'r', type: 'rect', x: 0, y: 0, w: 70, h: 37, stroke: 0.4, radius: 2, filled: false },
			{ id: 'b', type: 'barcode', x: 2, y: 2, w: 30, h: 30, symbology: 'qrcode', value: '{url}' }
		]
	};

	it('skaliert Positionen je Achse, Schrift und Linien mit dem kleineren Faktor', () => {
		const s = scaleLayout(layout, 35, 37);
		expect(s.widthMm).toBe(35);
		const t = s.elements[0]!;
		expect(t).toMatchObject({ x: 17.5, y: 10, w: 15, h: 10, fontSizePt: 6 });
		expect(s.elements[1]).toMatchObject({ w: 35, stroke: 0.2, radius: 1 });
		expect(labelLayoutSchema.safeParse(s).success).toBe(true);
		// Schrift nie unter 4 pt
		const tiny = scaleLayout(layout, 7, 3.7);
		expect((tiny.elements[0] as { fontSizePt: number }).fontSizePt).toBe(4);
		expect(tiny.elements.every((e) => e.w >= 1 && e.h >= 1)).toBe(true);
	});

	it('findet überstehende Elemente', () => {
		expect(overflowing(layout)).toEqual([]);
		expect(overflowing({ ...layout, widthMm: 50 }).map((e) => e.id)).toEqual(['t', 'r']);
	});

	it('ändert die Ebenen-Reihenfolge', () => {
		const ids = (els: LabelLayout['elements']) => els.map((e) => e.id).join('');
		expect(ids(reorder(layout.elements, 't', 'front'))).toBe('rbt');
		expect(ids(reorder(layout.elements, 'b', 'back'))).toBe('btr');
		expect(ids(reorder(layout.elements, 't', 'forward'))).toBe('rtb');
		expect(ids(reorder(layout.elements, 't', 'backward'))).toBe('trb');
		expect(ids(reorder(layout.elements, 'x', 'front'))).toBe('trb');
	});

	it('neue Elemente und Kopien sind gültig und liegen im Etikett', () => {
		for (const type of ['text', 'barcode', 'image', 'rect', 'line'] as const) {
			const el = createElement(type, { widthMm: 38.1, heightMm: 21.2 }, { target: 'blank' });
			const next = { widthMm: 38.1, heightMm: 21.2, elements: [el, duplicateElement(el)] };
			expect(labelLayoutSchema.safeParse(next).success, type).toBe(true);
			expect(overflowing({ ...next, elements: [el] })).toEqual([]);
			expect(next.elements[1]!.id).not.toBe(el.id);
		}
		expect(createElement('text', { widthMm: 70, heightMm: 37 }, { target: 'blank' })).toMatchObject(
			{ text: '{code}' }
		);
	});

	it('liefert Beispielwerte je Ziel', () => {
		expect(sampleValues('set').name).toBe('Kohte 3');
		expect(sampleValues('blank').name).toBeUndefined();
	});
});

describe('Etiketten-Designer: Rückgängig/Wiederholen', () => {
	it('nimmt Schritte auf, fasst schnelle Eingaben zusammen und stellt wieder her', () => {
		let h = createHistory(0);
		h = pushHistory(h, 1, null, 1000);
		h = pushHistory(h, 2, 'font', 2000);
		h = pushHistory(h, 3, 'font', 2000 + HISTORY_MERGE_MS - 1);
		expect(h.present).toBe(3);
		expect(h.past).toEqual([0, 1]);
		h = pushHistory(h, 4, 'font', 2000 + HISTORY_MERGE_MS * 3);
		expect(h.past).toEqual([0, 1, 3]);
		h = undoHistory(h);
		h = undoHistory(h);
		expect(h.present).toBe(1);
		h = redoHistory(h);
		expect(h.present).toBe(3);
		h = pushHistory(h, 9, null, 9000);
		expect(h.future).toEqual([]);
		expect(undoHistory(createHistory(5))).toEqual(createHistory(5));
		expect(redoHistory(createHistory(5))).toEqual(createHistory(5));
	});
});

describe('Etiketten: Startlayouts', () => {
	it('alle Startlayouts sind gültig, nutzen Felder ihres Ziels und passen ins Format', () => {
		for (const s of LABEL_STARTERS) {
			const preset = LABEL_FORMAT_PRESETS.find((p) => p.key === s.formatKey);
			expect(preset, s.id).toBeTruthy();
			const layout = starterLayout(s, preset!.format.labelWidthMm, preset!.format.labelHeightMm);
			expect(labelLayoutSchema.safeParse(layout).success, s.id).toBe(true);
			expect(overflowing(layout), s.id).toEqual([]);
		}
	});
});
