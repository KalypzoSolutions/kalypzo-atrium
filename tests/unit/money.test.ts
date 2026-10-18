import { describe, expect, it } from 'vitest';
import {
	ceilToEuroCents,
	formatCents,
	formatEuro,
	parseEuroToCents
} from '../../src/lib/components/layout/money';

describe('parseEuroToCents', () => {
	it.each([
		['12,5', 1250],
		['12,50', 1250],
		['1.234,50', 123450],
		['1.234,5', 123450],
		['12.50', 1250],
		['12.5', 1250],
		['1.234', 123400],
		['1.234.567', 123456700],
		['0,05', 5],
		[',5', 50],
		['12', 1200],
		['12 €', 1200],
		['12,505', 1251],
		['12,504', 1250],
		['0', 0],
		['1.000.000.000,00', 100_000_000_000]
	])('%s -> %d', (input, expected) => {
		expect(parseEuroToCents(input)).toBe(expected);
	});

	it('liefert null bei ungültiger oder leerer Eingabe', () => {
		for (const s of ['abc', '', '  ', ',', '.', '1,2,3', '1,2.3']) {
			expect(parseEuroToCents(s)).toBeNull();
		}
	});

	it('lehnt negative Beträge ab (null)', () => {
		expect(parseEuroToCents('-3')).toBeNull();
		expect(parseEuroToCents('-0,50')).toBeNull();
	});

	it('lehnt absurd große Werte ab', () => {
		expect(parseEuroToCents('1' + '0'.repeat(20))).toBeNull();
	});
});

describe('formatCents / formatEuro', () => {
	it('formatiert deutsch mit zwei Nachkommastellen', () => {
		expect(formatCents(123450)).toBe('1.234,50');
		expect(formatCents(5)).toBe('0,05');
		expect(formatCents(0)).toBe('0,00');
	});
	it('formatiert mit Euro-Zeichen', () => {
		expect(formatEuro(123450).replace(/\s/g, ' ')).toBe('1.234,50 €');
	});
	it('Roundtrip', () => {
		for (const c of [0, 1, 99, 100, 123456, 100_000_000]) {
			expect(parseEuroToCents(formatCents(c))).toBe(c);
		}
	});
});

describe('ceilToEuroCents', () => {
	it('rundet auf volle Euro auf', () => {
		expect(ceilToEuroCents(0)).toBe(0);
		expect(ceilToEuroCents(1)).toBe(100);
		expect(ceilToEuroCents(100)).toBe(100);
		expect(ceilToEuroCents(1001)).toBe(1100);
	});
});
