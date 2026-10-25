/**
 * Stammeswebsite: Datumsformate (`website/src/lib/dates.ts`) und Logik der Terminseite (`event-view.ts`), rein.
 */
import { describe, expect, it } from 'vitest';
import {
	formatDateRange,
	formatTimeRange,
	formatWhen,
	lastDay,
	todayBerlin
} from '../../website/src/lib/dates';
import {
	describeRhythm,
	filterEvents,
	groupByMonth,
	splitSingles,
	summarizeSeries
} from '../../website/src/lib/event-view';
import type { SiteEvent } from '../../website/src/lib/site-types';

function ev(over: Partial<SiteEvent> & { id: string; startsOn: string }): SiteEvent {
	return {
		key: over.recurring ? `${over.id}~${over.startsOn}` : over.id,
		title: over.id,
		description: '',
		location: null,
		color: null,
		startsTime: null,
		endsOn: null,
		endsTime: null,
		recurring: false,
		occurrenceDate: over.recurring ? over.startsOn : null,
		groups: [],
		tags: [],
		galleries: [],
		...over
	};
}

describe('dates', () => {
	it('Zeitraum ohne Uhrzeit', () => {
		expect(formatDateRange({ startsOn: '2026-11-14' })).toBe('Sa., 14. Nov. 2026');
		expect(formatDateRange({ startsOn: '2026-11-14', endsOn: '2026-11-16' })).toBe(
			'14.–16. Nov. 2026'
		);
		expect(formatDateRange({ startsOn: '2026-10-30', endsOn: '2026-11-02' })).toBe(
			'30. Okt. – 2. Nov. 2026'
		);
		expect(formatDateRange({ startsOn: '2026-12-30', endsOn: '2027-01-02' })).toBe(
			'30. Dez. 2026 – 2. Jan. 2027'
		);
		// Ende = Beginn zählt als eintägig
		expect(formatDateRange({ startsOn: '2026-11-14', endsOn: '2026-11-14' })).toBe(
			'Sa., 14. Nov. 2026'
		);
	});

	it('Uhrzeiten', () => {
		expect(formatTimeRange('16:30', '18:00')).toBe('16:30–18:00 Uhr');
		expect(formatTimeRange('16:30:00', null)).toBe('16:30 Uhr');
		expect(formatTimeRange(null, '18:00')).toBe('');
		expect(
			formatWhen({
				startsOn: '2026-11-14',
				startsTime: '10:00',
				endsOn: '2026-11-16',
				endsTime: '14:00'
			})
		).toBe('14.–16. Nov. 2026 · 10:00 bis 14:00 Uhr');
		expect(lastDay({ startsOn: '2026-11-14', endsOn: '2026-11-16' })).toBe('2026-11-16');
	});

	it('heute in Berlin, nicht UTC', () => {
		// 23:30 UTC am 31.12. ist in Berlin schon Neujahr
		expect(todayBerlin(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
	});
});

describe('event-view', () => {
	const weekly = ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27'].map((d) =>
		ev({ id: 'gs', startsOn: d, recurring: true, startsTime: '16:30', endsTime: '18:00' })
	);

	it('Rhythmus aus den Vorkommen', () => {
		expect(describeRhythm(['2026-11-06', '2026-11-13', '2026-11-20'])).toBe('jeden Freitag');
		expect(describeRhythm(['2026-11-06', '2026-11-20', '2026-12-04'])).toBe(
			'alle zwei Wochen freitags'
		);
		expect(describeRhythm(['2026-11-06', '2026-11-13', '2026-11-27'])).toBe(
			'freitags (nicht jede Woche)'
		);
		expect(describeRhythm(['2026-01-15', '2026-02-15', '2026-03-15'])).toBe('monatlich');
		expect(describeRhythm(['2026-01-15'])).toBe('regelmäßig');
	});

	it('Serien werden einmal zusammengefasst (nächstes Vorkommen ab heute)', () => {
		const [s] = summarizeSeries(weekly, '2026-11-14');
		expect(s?.next.startsOn).toBe('2026-11-20');
		expect(s?.upcomingCount).toBe(2);
		expect(s?.rhythm).toBe('jeden Freitag');
		expect(s?.time).toBe('16:30–18:00 Uhr');
		// vollständig vergangene Serie erscheint nicht
		expect(summarizeSeries(weekly, '2026-12-01')).toEqual([]);
	});

	it('Einzeltermine: kommend aufsteigend, vergangen absteigend, laufende zählen als kommend', () => {
		const list = [
			ev({ id: 'alt', startsOn: '2026-10-01' }),
			ev({ id: 'lager', startsOn: '2026-11-10', endsOn: '2026-11-16' }),
			ev({ id: 'neu', startsOn: '2026-12-01' }),
			...weekly
		];
		const { upcoming, past } = splitSingles(list, '2026-11-14');
		expect(upcoming.map((e) => e.id)).toEqual(['lager', 'neu']);
		expect(past.map((e) => e.id)).toEqual(['alt']);
		expect(groupByMonth(upcoming).map((m) => m.month)).toEqual(['2026-11', '2026-12']);
	});

	it('Filter: Gruppe ODER, Thema ODER, Suche mit gefalteten Umlauten', () => {
		const list = [
			ev({
				id: 'a',
				startsOn: '2026-11-01',
				groups: [{ id: 'g1', name: 'Meute', color: null, href: null }]
			}),
			ev({ id: 'b', startsOn: '2026-11-02', tags: ['Fahrt'], title: 'Fahrt nach Großenkneten' }),
			ev({ id: 'c', startsOn: '2026-11-03', location: 'Bürgerhaus' })
		];
		expect(filterEvents(list, { groups: ['g1'], tags: [], q: '' }).map((e) => e.id)).toEqual(['a']);
		expect(filterEvents(list, { groups: [], tags: ['Fahrt'], q: '' }).map((e) => e.id)).toEqual([
			'b'
		]);
		expect(
			filterEvents(list, { groups: [], tags: [], q: 'grossenkneten' }).map((e) => e.id)
		).toEqual(['b']);
		expect(filterEvents(list, { groups: [], tags: [], q: 'burgerhaus' }).map((e) => e.id)).toEqual([
			'c'
		]);
	});
});
