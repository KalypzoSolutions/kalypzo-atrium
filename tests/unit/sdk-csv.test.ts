import { describe, expect, it } from 'vitest';
import { csvCell, csvCents, csvDocument, csvFromRecords } from '$lib/sdk/csv';
import { centsPlain, formatEuro } from '$lib/components/layout/money';

describe('csvCell – Formelschutz-Matrix (#34)', () => {
	it('echte Zahlen und Beträge bleiben Zahlen (auch negativ)', () => {
		expect(csvCell(5)).toBe('5');
		expect(csvCell(-5)).toBe('-5');
		expect(csvCell(1.5)).toBe('1,5');
		expect(csvCell(Number.NaN)).toBe('');
		expect(csvCell(csvCents(-1250))).toBe('-12,50');
		expect(csvCell(csvCents(123450))).toBe('1234,50');
	});
	it('Texte mit = + - @ Tab CR werden geschützt – auch wenn sie wie Zahlen aussehen', () => {
		for (const bad of ['=SUMME(A1)', '+49 171', '-12,50', '-1+1', '@x']) {
			expect(csvCell(bad)).toBe(`'${bad}`);
		}
		expect(csvCell('\tTab')).toBe("'\tTab");
		expect(csvCell('\rx')).toBe(`"'\rx"`);
	});
	it('Quoting bei ; " CR LF', () => {
		expect(csvCell('a;b')).toBe('"a;b"');
		expect(csvCell('sagt "hi"')).toBe('"sagt ""hi"""');
		expect(csvCell('a\nb')).toBe('"a\nb"');
		expect(csvCell('=a;b')).toBe(`"'=a;b"`);
		expect(csvCell(null)).toBe('');
		expect(csvCell(undefined)).toBe('');
		expect(csvCell(true)).toBe('true');
	});
});

describe('csvDocument / csvFromRecords', () => {
	it('BOM, Semikolon, CRLF auch nach der letzten Zeile', () => {
		const csv = csvDocument(['Name', 'Betrag'], [['=X', csvCents(-1250)]]);
		expect(csv).toBe("\ufeffName;Betrag\r\n'=X;-12,50\r\n");
	});
	it('aus Objekten nach Spalten', () => {
		const csv = csvFromRecords(
			[{ a: '@a', b: 5 }, { a: null }],
			[
				{ key: 'a', label: 'A' },
				{ key: 'b', label: 'B' }
			]
		);
		expect(csv).toBe("\ufeffA;B\r\n'@a;5\r\n;\r\n");
	});
});

describe('Geld', () => {
	it('centsPlain ohne Tausenderpunkt, mit Vorzeichen', () => {
		expect(centsPlain(123450)).toBe('1234,50');
		expect(centsPlain(-5)).toBe('-0,05');
		expect(centsPlain(0)).toBe('0,00');
		expect(centsPlain(Number.POSITIVE_INFINITY)).toBe('0,00');
		expect(centsPlain(12.6)).toBe('0,13');
	});
	it('formatEuro mit Tausenderpunkt und geschütztem Leerzeichen', () => {
		expect(formatEuro(123450)).toBe('1.234,50\u00a0€');
		expect(formatEuro(-1250)).toBe('-12,50\u00a0€');
	});
});
