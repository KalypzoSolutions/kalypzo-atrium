import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addDays,
	ageFromBirthDate,
	daysBetween,
	formatDateDe,
	formatDateTimeDe,
	isRealDate,
	setTodayForTests,
	todayBerlin
} from '$lib/sdk/dates';

afterEach(() => {
	setTodayForTests(null);
	vi.useRealTimers();
});

describe('todayBerlin (#32)', () => {
	it('Tagesgrenze Winterzeit: 23:30 UTC = 00:30 MEZ des Folgetags', () => {
		expect(todayBerlin(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
		expect(todayBerlin(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31');
		expect(todayBerlin(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01');
	});
	it('Tagesgrenze Sommerzeit: 22:30 UTC = 00:30 MESZ', () => {
		expect(todayBerlin(new Date('2026-10-20T22:30:00Z'))).toBe('2026-10-21');
		expect(todayBerlin(new Date('2026-10-20T21:59:00Z'))).toBe('2026-10-20');
	});
	it('Zeitumstellung (29.03.2026 / 25.10.2026)', () => {
		expect(todayBerlin(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29'); // 00:30 MEZ
		expect(todayBerlin(new Date('2026-03-29T21:59:00Z'))).toBe('2026-03-29'); // 23:59 MESZ
		expect(todayBerlin(new Date('2026-03-29T22:00:00Z'))).toBe('2026-03-30');
		expect(todayBerlin(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25'); // 00:00 MESZ
		expect(todayBerlin(new Date('2026-10-25T22:59:00Z'))).toBe('2026-10-25'); // 23:59 MEZ
	});
	it('ohne Argument: Systemzeit bzw. zentraler Test-Override', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-20T22:30:00Z'));
		expect(todayBerlin()).toBe('2026-10-21');
		setTodayForTests('2026-06-01');
		expect(todayBerlin()).toBe('2026-06-01');
		// mit Zeitpunkt zählt immer der Zeitpunkt
		expect(todayBerlin(new Date('2026-01-01T12:00:00Z'))).toBe('2026-01-01');
		setTodayForTests(null);
		expect(todayBerlin()).toBe('2026-10-21');
		expect(() => setTodayForTests('2026-02-30')).toThrow();
	});
});

describe('isRealDate / addDays / daysBetween', () => {
	it('echte Kalenderdaten', () => {
		expect(isRealDate('2024-02-29')).toBe(true);
		expect(isRealDate('2026-02-29')).toBe(false);
		expect(isRealDate('2026-02-30')).toBe(false);
		expect(isRealDate('2026-1-5')).toBe(false);
		expect(isRealDate('0026-01-05')).toBe(false);
		expect(isRealDate('')).toBe(false);
	});
	it('Arithmetik auf reinen Kalenderdaten (keine Sommerzeit-Sprünge)', () => {
		expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
		expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDays('kaputt', 1)).toBe('kaputt');
		expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
		expect(daysBetween('2026-10-25', '2026-10-24')).toBe(-1);
		expect(Number.isNaN(daysBetween('x', '2026-01-01'))).toBe(true);
	});
});

describe('formatDateDe / formatDateTimeDe', () => {
	it('Datum und Zeitstempel (Kalendertag in Berlin)', () => {
		expect(formatDateDe('2026-03-07')).toBe('07.03.2026');
		expect(formatDateDe('2026-03-07T23:30:00Z')).toBe('08.03.2026');
		expect(formatDateDe(null)).toBe('');
		expect(formatDateDe(undefined, '–')).toBe('–');
		expect(formatDateDe('irgendwas')).toBe('irgendwas');
	});
	it('Zeitpunkt in Europe/Berlin', () => {
		expect(formatDateTimeDe('2026-10-20T22:30:00Z')).toBe('21.10.2026, 00:30');
		expect(formatDateTimeDe('kaputt', '–')).toBe('–');
		expect(formatDateTimeDe(null)).toBe('');
	});
});

describe('ageFromBirthDate', () => {
	it('Geburtstag am Stichtag zählt, Schaltjahr', () => {
		expect(ageFromBirthDate('2013-06-15', '2026-06-15')).toBe(13);
		expect(ageFromBirthDate('2013-06-16', '2026-06-15')).toBe(12);
		expect(ageFromBirthDate('2012-02-29', '2026-02-28')).toBe(13);
		expect(ageFromBirthDate('2012-02-29', '2026-03-01')).toBe(14);
		expect(ageFromBirthDate('15.06.2013', '2026-06-15')).toBeNull();
		expect(ageFromBirthDate('2027-01-01', '2026-06-15')).toBe(-1);
	});
	it('Standard-Stichtag ist heute in Berlin', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-06-14T22:30:00Z')); // 15.06. 00:30 MESZ
		expect(ageFromBirthDate('2013-06-15')).toBe(13);
	});
});
