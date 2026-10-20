import { describe, expect, it } from 'vitest';
import {
	addDays,
	buildAgenda,
	buildMonthGrid,
	calendarItemKey,
	contrastTextColor,
	describeItem,
	formatDayLabel,
	formatLongDate,
	formatMonthLabel,
	itemsOnDay,
	layoutWeek,
	shiftMonth,
	weekdayIndex,
	type CalendarItem
} from '../../src/lib/components/layout/month-calendar';

const item = (id: string, startsOn: string, endsOn?: string, extra: Partial<CalendarItem> = {}) =>
	({ id, title: id, startsOn, endsOn: endsOn ?? null, ...extra }) satisfies CalendarItem;

describe('Datumshilfen', () => {
	it('rechnet Tage und Monate über Grenzen', () => {
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(weekdayIndex('2026-10-19')).toBe(0); // Montag
		expect(weekdayIndex('2026-10-18')).toBe(6); // Sonntag
	});

	it('formatiert deutsch', () => {
		expect(formatMonthLabel('2026-10')).toBe('Oktober 2026');
		expect(formatDayLabel('2026-10-19')).toBe('Mo, 19.10.');
		expect(formatLongDate('2026-10-19')).toBe('Montag, 19. Oktober 2026');
	});
});

describe('buildMonthGrid', () => {
	it('liefert immer 6 Wochen à 7 Tage ab Montag', () => {
		const g = buildMonthGrid('2026-10'); // 1.10.2026 ist ein Donnerstag
		expect(g).toHaveLength(6);
		for (const w of g) {
			expect(w).toHaveLength(7);
			expect(weekdayIndex(w[0]!)).toBe(0);
		}
		expect(g[0]![0]).toBe('2026-09-28');
		expect(g[0]![3]).toBe('2026-10-01');
		expect(g[5]![6]).toBe('2026-11-08');
	});

	it('Monatsbeginn an einem Sonntag steht in der letzten Spalte der ersten Woche', () => {
		const g = buildMonthGrid('2026-02'); // 1.2.2026 ist ein Sonntag
		expect(g[0]![6]).toBe('2026-02-01');
		expect(g[0]![0]).toBe('2026-01-26');
	});

	it('Monatsbeginn an einem Montag steht in der ersten Spalte', () => {
		const g = buildMonthGrid('2026-06'); // 1.6.2026 ist ein Montag
		expect(g[0]![0]).toBe('2026-06-01');
		expect(g[5]![6]).toBe('2026-07-12');
	});

	it('Schaltjahr: Februar 2028 enthält den 29.', () => {
		const days = buildMonthGrid('2028-02').flat();
		expect(days).toContain('2028-02-29');
		expect(days[days.indexOf('2028-02-29') + 1]).toBe('2028-03-01');
		expect(buildMonthGrid('2027-02').flat()).not.toContain('2027-02-29');
	});
});

describe('layoutWeek', () => {
	const week = buildMonthGrid('2026-10')[3]!; // 19.10. – 25.10.

	it('legt überlappende Termine in getrennte Spuren und nutzt freie Spuren wieder', () => {
		const items = [
			item('lang', '2026-10-19', '2026-10-22'),
			item('mitte', '2026-10-21', '2026-10-23'),
			item('spaet', '2026-10-23'), // überlappt "mitte" → Spur 0 frei (lang endet am 22.)
			item('kurz', '2026-10-20')
		];
		const { segments, hidden } = layoutWeek(week, items);
		const byId = Object.fromEntries(segments.map((s) => [s.item.id, s]));
		expect(byId.lang).toMatchObject({ startCol: 0, span: 4, lane: 0 });
		expect(byId.kurz).toMatchObject({ startCol: 1, span: 1, lane: 1 });
		expect(byId.mitte).toMatchObject({ startCol: 2, span: 3, lane: 1 });
		expect(byId.spaet).toMatchObject({ startCol: 4, span: 1, lane: 0 });
		expect(hidden).toEqual([0, 0, 0, 0, 0, 0, 0]);
	});

	it('längere Termine zuerst, bei gleichem Beginn', () => {
		const { segments } = layoutWeek(week, [
			item('eintag', '2026-10-19'),
			item('dreitag', '2026-10-19', '2026-10-21')
		]);
		expect(segments.find((s) => s.item.id === 'dreitag')!.lane).toBe(0);
		expect(segments.find((s) => s.item.id === 'eintag')!.lane).toBe(1);
	});

	it('mehr als 3 Spuren → ausgeblendet und je Tag gezählt', () => {
		const items = [
			item('a', '2026-10-21'),
			item('b', '2026-10-21'),
			item('c', '2026-10-21'),
			item('d', '2026-10-21'),
			item('e', '2026-10-20', '2026-10-21')
		];
		const { segments, hidden } = layoutWeek(week, items);
		expect(segments).toHaveLength(3);
		expect(hidden).toEqual([0, 0, 2, 0, 0, 0, 0]);
		expect(itemsOnDay(items, '2026-10-21')).toHaveLength(5);
	});

	it('Termin über die Wochengrenze wird je Woche abgeschnitten', () => {
		const weeks = buildMonthGrid('2026-10');
		const it1 = item('fahrt', '2026-10-24', '2026-10-27');
		const w3 = layoutWeek(weeks[3]!, [it1]).segments[0]!;
		const w4 = layoutWeek(weeks[4]!, [it1]).segments[0]!;
		expect(w3).toMatchObject({
			startCol: 5,
			span: 2,
			continuesBefore: false,
			continuesAfter: true
		});
		expect(w4).toMatchObject({
			startCol: 0,
			span: 2,
			continuesBefore: true,
			continuesAfter: false
		});
	});

	it('Termin über die Monatsgrenze erscheint auch in den Randtagen', () => {
		const weeks = buildMonthGrid('2026-11'); // erste Woche: 26.10. – 1.11.
		const seg = layoutWeek(weeks[0]!, [item('herbst', '2026-10-20', '2026-11-03')]).segments[0]!;
		expect(seg).toMatchObject({
			startCol: 0,
			span: 7,
			continuesBefore: true,
			continuesAfter: true
		});
	});

	it('Spuren werden pro Woche neu begonnen', () => {
		const weeks = buildMonthGrid('2026-10');
		const items = [item('a', '2026-10-22', '2026-10-27'), item('b', '2026-10-23', '2026-10-28')];
		const next = layoutWeek(weeks[4]!, items).segments;
		expect(next.map((s) => s.lane).sort()).toEqual([0, 1]);
		const only = layoutWeek(weeks[4]!, [item('c', '2026-10-28')]).segments[0]!;
		expect(only.lane).toBe(0);
	});

	it('ignoriert ungültige Daten und behandelt Ende vor Beginn als eintägig', () => {
		const { segments } = layoutWeek(week, [
			item('kaputt', '2026-13-01'),
			item('rückwärts', '2026-10-22', '2026-10-20')
		]);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toMatchObject({ startCol: 3, span: 1 });
	});
});

describe('buildAgenda', () => {
	it('listet nur Tage des Monats mit Terminen, mehrtägige nur am ersten sichtbaren Tag', () => {
		const days = buildAgenda('2026-10', [
			item('x', '2026-09-30', '2026-10-02'),
			item('y', '2026-10-19', undefined, { startsTime: '18:00' }),
			item('z', '2026-11-01')
		]);
		expect(days.map((d) => d.date)).toEqual(['2026-10-01', '2026-10-19']);
		expect(days[0]!.items.map((i) => i.id)).toEqual(['x']);
		expect(days[1]!.items[0]!.id).toBe('y');
	});

	it('mehrtägiger Termin im Monat erscheint genau einmal am Beginn', () => {
		const days = buildAgenda('2026-10', [
			item('fahrt', '2026-10-09', '2026-10-12'),
			item('heim', '2026-10-10')
		]);
		expect(days.map((d) => d.date)).toEqual(['2026-10-09', '2026-10-10']);
		expect(days.flatMap((d) => d.items).filter((i) => i.id === 'fahrt')).toHaveLength(1);
	});

	it('Termin über die Monatsgrenze hinaus erscheint am Beginn, Termin vor dem Monat gar nicht', () => {
		const days = buildAgenda('2026-10', [
			item('lager', '2026-10-30', '2026-11-03'),
			item('alt', '2026-09-20', '2026-09-30')
		]);
		expect(days.map((d) => d.date)).toEqual(['2026-10-30']);
		expect(buildAgenda('2026-11', [item('lager', '2026-10-30', '2026-11-03')])[0]!.date).toBe(
			'2026-11-01'
		);
	});

	it('Serien-Vorkommen mit gleicher ID bleiben getrennt (Schlüssel)', () => {
		const days = buildAgenda('2026-10', [
			item('s', '2026-10-05', undefined, { key: 's:2026-10-05', recurring: true }),
			item('s', '2026-10-12', undefined, { key: 's:2026-10-12', recurring: true })
		]);
		expect(days.map((d) => calendarItemKey(d.items[0]!))).toEqual(['s:2026-10-05', 's:2026-10-12']);
		expect(days).toHaveLength(2);
	});

	it('ungültiger Monat → leer', () => {
		expect(buildAgenda('2026-13', [item('x', '2026-10-01')])).toEqual([]);
	});
});

describe('Serien', () => {
	it('calendarItemKey nutzt key, sonst id', () => {
		expect(calendarItemKey(item('a', '2026-10-01'))).toBe('a');
		expect(calendarItemKey(item('a', '2026-10-01', undefined, { key: 'a:2026-10-01' }))).toBe(
			'a:2026-10-01'
		);
	});

	it('describeItem ergänzt „(Serie)“', () => {
		expect(describeItem(item('Heimabend', '2026-10-19', undefined, { recurring: true }))).toBe(
			'Heimabend (Serie), Montag, 19. Oktober 2026'
		);
		expect(describeItem(item('Heimabend', '2026-10-19'))).toBe(
			'Heimabend, Montag, 19. Oktober 2026'
		);
	});
});

describe('contrastTextColor', () => {
	it('wählt helle Schrift auf dunklen und dunkle auf hellen Farben', () => {
		expect(contrastTextColor('#000000')).toBe('#ffffff');
		expect(contrastTextColor('#2563eb')).toBe('#ffffff');
		expect(contrastTextColor('#ffffff')).toBe('#111827');
		expect(contrastTextColor('#facc15')).toBe('#111827');
		expect(contrastTextColor('#fff')).toBe('#111827');
	});

	it('liefert null bei ungültiger Farbe', () => {
		expect(contrastTextColor(null)).toBeNull();
		expect(contrastTextColor('')).toBeNull();
		expect(contrastTextColor('red')).toBeNull();
		expect(contrastTextColor('#12345')).toBeNull();
	});
});
