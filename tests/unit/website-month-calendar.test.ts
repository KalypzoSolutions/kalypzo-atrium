/**
 * Stammeswebsite: Die Kalender-Logik ist eine Kopie aus dem Intern-Bereich (die Website importiert nichts aus `src/`).
 * Dieser Test hält beide Fassungen gleich.
 */
import { describe, expect, it } from 'vitest';
import * as original from '../../src/lib/components/layout/month-calendar';
import * as copy from '../../website/src/lib/month-calendar';

const items: original.CalendarItem[] = [
	{ id: 'a', title: 'Lager', startsOn: '2026-10-28', endsOn: '2026-11-03', color: '#2563eb' },
	{
		id: 'b',
		title: 'Gruppenstunde',
		startsOn: '2026-11-06',
		startsTime: '16:30',
		endsTime: '18:00'
	},
	{ id: 'c', title: 'Fahrt', startsOn: '2026-11-06', endsOn: '2026-11-08', color: '#fde047' },
	{ id: 'd', title: 'Basteln', startsOn: '2026-11-06', startsTime: '10:00' },
	{ id: 'e', title: 'Elternabend', startsOn: '2026-11-06', startsTime: '19:00', recurring: true },
	{ id: 'f', title: 'Kaputt', startsOn: '2026-02-30' }
];

describe('website/month-calendar = Intern-Fassung', () => {
	it('Raster, Wochen-Layout und Agenda', () => {
		for (const month of ['2026-11', '2026-02', '2024-02', '2027-01']) {
			expect(copy.buildMonthGrid(month)).toEqual(original.buildMonthGrid(month));
			for (const days of original.buildMonthGrid(month)) {
				expect(copy.layoutWeek(days, items)).toEqual(original.layoutWeek(days, items));
			}
			expect(copy.buildAgenda(month, items)).toEqual(original.buildAgenda(month, items));
		}
	});

	it('Formate und Hilfen', () => {
		for (const it of items) {
			expect(copy.describeItem(it)).toBe(original.describeItem(it));
			expect(copy.formatItemTime(it)).toBe(original.formatItemTime(it));
			expect(copy.itemRange(it)).toEqual(original.itemRange(it));
		}
		expect(copy.formatMonthLabel('2026-11')).toBe(original.formatMonthLabel('2026-11'));
		expect(copy.shiftMonth('2026-12', 1)).toBe('2027-01');
		expect(copy.itemsOnDay(items, '2026-11-06')).toEqual(original.itemsOnDay(items, '2026-11-06'));
	});

	it('Kontrastfarbe gleich', () => {
		for (const c of ['#ffffff', '#000000', '#2563eb', '#fde047', '#808080', '#777', 'rot', null]) {
			expect(copy.contrastTextColor(c)).toBe(original.contrastTextColor(c));
		}
	});
});
