import { describe, expect, it } from 'vitest';
import {
	contrastTextColor,
	hexToHsv,
	hexToRgb,
	hsvToHex,
	hsvToRgb,
	normalizeHex,
	rgbToHex,
	rgbToHsv
} from '../../src/lib/components/ui/color-picker/color';

describe('normalizeHex', () => {
	it('expandiert Kurzform und setzt Kleinbuchstaben', () => {
		expect(normalizeHex('#ABC')).toBe('#aabbcc');
		expect(normalizeHex(' #2F855A ')).toBe('#2f855a');
	});
	it('lehnt Ungueltiges ab', () => {
		for (const v of ['', 'abc', '#abcd', '#12345', '#gggggg', 'red', '#1234567'])
			expect(normalizeHex(v)).toBeNull();
	});
});

describe('Konvertierungen', () => {
	it('hexToRgb / rgbToHex', () => {
		expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
		expect(hexToRgb('#f80')).toEqual({ r: 255, g: 136, b: 0 });
		expect(hexToRgb('nope')).toBeNull();
		expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe('#ff8000');
		expect(rgbToHex({ r: -5, g: 300, b: 0.4 })).toBe('#00ff00');
	});
	it('Primaerfarben in HSV', () => {
		expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
		expect(rgbToHsv({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 1, v: 1 });
		expect(rgbToHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 1, v: 1 });
		expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
		expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 1 });
		expect(hsvToRgb({ h: 60, s: 1, v: 1 })).toEqual({ r: 255, g: 255, b: 0 });
		expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
	});
	it('Round-Trip hex -> hsv -> hex ist verlustfrei', () => {
		for (const hex of [
			'#2f855a',
			'#c53030',
			'#ecc94b',
			'#718096',
			'#000000',
			'#ffffff',
			'#123456'
		]) {
			const hsv = hexToHsv(hex);
			expect(hsv).not.toBeNull();
			expect(hsvToHex(hsv!)).toBe(hex);
		}
		expect(hexToHsv('xyz')).toBeNull();
	});
	it('Round-Trip ueber viele Farben', () => {
		for (let r = 0; r < 256; r += 51)
			for (let g = 0; g < 256; g += 51)
				for (let b = 0; b < 256; b += 51) {
					const hex = rgbToHex({ r, g, b });
					expect(hsvToHex(hexToHsv(hex)!)).toBe(hex);
				}
	});
});

describe('contrastTextColor', () => {
	it('liefert Weiss auf dunklen und Schwarz auf hellen Farben', () => {
		expect(contrastTextColor('#000000')).toBe('#ffffff');
		expect(contrastTextColor('#276749')).toBe('#ffffff');
		expect(contrastTextColor('#ffffff')).toBe('#000000');
		expect(contrastTextColor('#ecc94b')).toBe('#000000');
	});
	it('faellt bei ungueltiger Eingabe auf Schwarz zurueck', () => {
		expect(contrastTextColor('kaputt')).toBe('#000000');
	});
});
