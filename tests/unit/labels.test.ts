import { describe, expect, it } from 'vitest';
import {
	LABEL_FORMAT_PRESETS,
	fillPlaceholders,
	fitLayout,
	formatProblem,
	labelFormatSchema,
	labelLayoutSchema,
	labelPageSize,
	labelsPerPage,
	placeLabels,
	placeholdersIn,
	resolveLayout,
	type LabelFormat,
	type LabelLayout
} from '$lib/sdk/labels';
import { barcodeDataUrl, barcodeSvg } from '$lib/sdk/labels/barcode';
import { ScanBuffer } from '$lib/components/layout/scan-input';
import { buildLabelsHtml } from '$lib/server/core/pdf/labels';

const sheet: LabelFormat = {
	kind: 'sheet',
	pageWidthMm: 210,
	pageHeightMm: 297,
	cols: 3,
	rows: 8,
	labelWidthMm: 70,
	labelHeightMm: 37,
	marginTopMm: 0.5,
	marginLeftMm: 0,
	gapXMm: 0,
	gapYMm: 0
};

const layout: LabelLayout = {
	widthMm: 70,
	heightMm: 37,
	elements: [
		{
			id: 't',
			type: 'text',
			x: 2,
			y: 2,
			w: 40,
			h: 10,
			text: '{name} <b>',
			fontSizePt: 10,
			bold: true,
			align: 'left',
			valign: 'top',
			maxLines: 2
		},
		{ id: 'b', type: 'barcode', x: 45, y: 2, w: 23, h: 23, symbology: 'qrcode', value: '{url}' }
	]
};

describe('Etiketten-Platzierung', () => {
	it('alle Vorgaben passen auf ihre Seite', () => {
		for (const p of LABEL_FORMAT_PRESETS) {
			expect(formatProblem(p.format), p.key).toBeNull();
			expect(labelFormatSchema.safeParse(p.format).success, p.key).toBe(true);
		}
	});

	it('Bogen: zeilenweise, Startfeld und Seitenumbruch', () => {
		expect(labelsPerPage(sheet)).toBe(24);
		const p = placeLabels(sheet, 3, 22);
		expect(p.map((x) => [x.page, x.x, x.y])).toEqual([
			[0, 70, 0.5 + 7 * 37],
			[0, 140, 0.5 + 7 * 37],
			[1, 0, 0.5]
		]);
	});

	it('Startfeld wird auf den Bogen geklemmt', () => {
		expect(placeLabels(sheet, 1, 99)[0]).toMatchObject({ page: 0, x: 140 });
		expect(placeLabels(sheet, 1, -5)[0]).toMatchObject({ page: 0, x: 0, y: 0.5 });
	});

	it('Rolle: ein Etikett je Seite in Etikettgröße', () => {
		const roll: LabelFormat = { kind: 'roll', labelWidthMm: 62, labelHeightMm: 29 };
		expect(labelPageSize(roll)).toEqual({ widthMm: 62, heightMm: 29 });
		expect(placeLabels(roll, 2, 5).map((x) => x.page)).toEqual([0, 1]);
	});

	it('zu großes Raster wird abgelehnt', () => {
		expect(formatProblem({ ...sheet, cols: 4 })).toMatch(/breiter/);
		expect(formatProblem({ ...sheet, rows: 9 })).toMatch(/höher/);
		expect(labelFormatSchema.safeParse({ ...sheet, rows: 9 }).success).toBe(false);
	});

	it('Layout wird gleichmäßig eingepasst und zentriert', () => {
		expect(fitLayout(layout, { width: 70, height: 37 })).toEqual({
			scale: 1,
			offsetX: 0,
			offsetY: 0
		});
		const f = fitLayout(layout, { width: 35, height: 37 });
		expect(f.scale).toBe(0.5);
		expect(f.offsetY).toBeCloseTo(9.25);
	});
});

describe('Platzhalter', () => {
	it('ersetzt bekannte, leert unbekannte', () => {
		expect(fillPlaceholders('{name} – {code} {x}', { name: 'Kohte', code: 'M-1' })).toBe(
			'Kohte – M-1 '
		);
		expect(placeholdersIn('{name}{code}{Name}')).toEqual(['name', 'code']);
	});

	it('leere Barcodes fallen weg', () => {
		expect(resolveLayout(layout, { name: 'A' }).map((e) => e.id)).toEqual(['t']);
		expect(resolveLayout(layout, { name: 'A', url: 'x' }).map((e) => e.id)).toEqual(['t', 'b']);
	});

	it('Layout-Schema prüft Elemente', () => {
		expect(labelLayoutSchema.safeParse(layout).success).toBe(true);
		const bad = { ...layout, elements: [{ ...layout.elements[0]!, fontSizePt: 200 }] };
		expect(labelLayoutSchema.safeParse(bad).success).toBe(false);
	});
});

describe('Barcodes', () => {
	it('liefert skalierbares SVG', () => {
		const svg = barcodeSvg('qrcode', 'https://example.org/modules/material/scan/M-000001');
		expect(svg).toMatch(/^<svg width="100%" height="100%" preserveAspectRatio="xMidYMid meet"/);
		expect(barcodeSvg('code128', 'M-000001')).toContain('preserveAspectRatio="none"');
		expect(barcodeSvg('datamatrix', 'M-000001')).toContain('<path');
		expect(barcodeDataUrl('qrcode', 'x')).toMatch(/^data:image\/svg\+xml/);
	});
});

describe('Etiketten-HTML', () => {
	it('escaped Werte, setzt Seitengröße und Seiten', () => {
		const { html, pages } = buildLabelsHtml({
			title: 'Test',
			format: sheet,
			layout,
			labels: Array.from({ length: 25 }, () => ({ name: '<script>', url: 'https://x/1' })),
			outlines: true
		});
		expect(pages).toBe(2);
		expect(html).toContain('@page { size: 210mm 297mm; margin: 0; }');
		expect(html).toContain('&lt;script&gt; &lt;b&gt;');
		expect(html).not.toContain('<script>');
		expect(html.match(/class="label"/g)).toHaveLength(25);
		expect(html).toContain('dashed');
	});
});

describe('USB-Scanner', () => {
	it('erkennt schnelle Tastenfolge mit Enter', () => {
		const b = new ScanBuffer();
		let t = 1000;
		for (const k of 'M-000123') expect(b.push(k, (t += 10))).toBeNull();
		expect(b.push('Enter', t + 10)).toBe('M-000123');
	});

	it('langsames Tippen ist kein Scan', () => {
		const b = new ScanBuffer();
		let t = 0;
		for (const k of 'abcd') b.push(k, (t += 200));
		expect(b.push('Enter', t + 200)).toBeNull();
	});

	it('zu kurze Codes werden ignoriert', () => {
		const b = new ScanBuffer({ minLength: 3 });
		b.push('a', 1);
		b.push('b', 2);
		expect(b.push('Enter', 3)).toBeNull();
	});
});
