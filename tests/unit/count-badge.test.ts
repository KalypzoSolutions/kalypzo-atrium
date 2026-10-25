/** Zähleranzeige (`formatCount`): leer bei 0, Zahl bis 9, danach „9+“ */
import { describe, expect, it } from 'vitest';
import { formatCount } from '$lib/components/layout/count';

describe('formatCount', () => {
	it('Grenzen', () => {
		expect(formatCount(0)).toBe('');
		expect(formatCount(-3)).toBe('');
		expect(formatCount(Number.NaN)).toBe('');
		expect(formatCount(1)).toBe('1');
		expect(formatCount(9)).toBe('9');
		expect(formatCount(10)).toBe('9+');
		expect(formatCount(250)).toBe('9+');
		expect(formatCount(2.7)).toBe('2');
		expect(formatCount(100, 99)).toBe('99+');
	});
});
