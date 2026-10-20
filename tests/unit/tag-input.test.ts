import { describe, expect, it } from 'vitest';
import { addTag, addTags, hasTag, normalizeTag } from '$lib/components/ui/tag-input/tags';

describe('normalizeTag', () => {
	it('trimmt und fasst Leerräume zusammen', () => {
		expect(normalizeTag('  Sommer   Lager \t 2026 ')).toBe('Sommer Lager 2026');
	});
	it('kappt auf maxLength (Codepoints) und trimmt danach', () => {
		expect(normalizeTag('abcdef', 3)).toBe('abc');
		expect(normalizeTag('ab cd', 3)).toBe('ab');
		expect(normalizeTag('äöü😀x', 4)).toBe('äöü😀');
	});
	it('liefert leer bei ungültiger Länge', () => {
		expect(normalizeTag('abc', 0)).toBe('');
		expect(normalizeTag('abc', Number.NaN)).toBe('');
	});
});

describe('addTag', () => {
	it('legt einen normalisierten Tag an', () => {
		expect(addTag([], '  Zelt  lager ')).toEqual(['Zelt lager']);
	});
	it('ignoriert leere Eingaben und gibt dieselbe Liste zurück', () => {
		const list = ['a'];
		expect(addTag(list, '   ')).toBe(list);
		expect(addTag(list, '')).toBe(list);
	});
	it('dedupliziert case-insensitiv', () => {
		const list = ['Wölflinge'];
		expect(addTag(list, 'WÖLFLINGE')).toBe(list);
		expect(addTag(list, ' wölflinge ')).toBe(list);
		expect(hasTag(list, 'wÖlFlInGe')).toBe(true);
	});
	it('respektiert max (Grenze, Grenze erreicht)', () => {
		expect(addTag(['a'], 'b', { max: 2 })).toEqual(['a', 'b']);
		const full = ['a', 'b'];
		expect(addTag(full, 'c', { max: 2 })).toBe(full);
	});
	it('Standard: max 20, maxLength 40', () => {
		const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
		expect(addTag(twenty, 'neu')).toBe(twenty);
		expect(addTag([], 'x'.repeat(41))).toEqual(['x'.repeat(40)]);
	});
	it('kappt Länge vor dem Duplikatvergleich', () => {
		expect(addTag(['abc'], 'ABCdef', { maxLength: 3 })).toEqual(['abc']);
	});
	it('verändert die Eingabeliste nicht', () => {
		const list = ['a'];
		const next = addTag(list, 'b');
		expect(list).toEqual(['a']);
		expect(next).toEqual(['a', 'b']);
	});
});

describe('addTags', () => {
	it('fügt mehrere Teile nacheinander hinzu (z. B. aus Kommas)', () => {
		expect(addTags(['x'], 'a, b ,,A, c'.split(','), { max: 3 })).toEqual(['x', 'a', 'b']);
	});
});
