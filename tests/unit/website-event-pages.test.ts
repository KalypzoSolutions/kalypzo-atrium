/**
 * Stammeswebsite (#48): Termine seitenweise nachladen (`website/src/lib/server/event-pages.ts`, rein).
 * Liegt in der Root-Testsuite, weil `website/` (noch) kein Vitest hat.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BackendEvent } from '../../website/src/lib/server/backend-types';
import {
	EVENT_PAGE_SIZE,
	MAX_EVENT_PAGES,
	eventKey,
	fetchEventWindows,
	fetchWindow,
	type EventPageFetcher
} from '../../website/src/lib/server/event-pages';

const ev = (id: string, occurrenceDate: string | null = null): BackendEvent => ({
	id,
	title: `Termin ${id}`,
	description: null,
	location: null,
	color: null,
	startsOn: occurrenceDate ?? '2026-03-01',
	startsTime: null,
	endsOn: null,
	endsTime: null,
	tags: [],
	groups: [],
	groupIds: [],
	recurring: occurrenceDate !== null,
	occurrenceDate
});

/** Backend mit Paging über eine feste Liste (wie `GET /website/events?paged=1`) */
function pagedBackend(all: BackendEvent[]): EventPageFetcher {
	return async ({ offset, limit }) => {
		const items = all.slice(offset, offset + limit);
		return { items, total: all.length, offset, limit, hasMore: offset + items.length < all.length };
	};
}

/** `n` Vorkommen einer Serie mit eindeutigen Schlüsseln */
const series = (n: number, id = 'serie') => Array.from({ length: n }, (_, i) => ev(id, `d${i}`));

describe('fetchWindow', () => {
	it('lädt 250 Vorkommen eines Halbjahres vollständig (zwei Seiten)', async () => {
		const fetchPage = vi.fn(pagedBackend(series(250)));
		const got = await fetchWindow(fetchPage, { from: '2026-01-01', to: '2026-06-30' });
		expect(got).toHaveLength(250);
		expect(new Set(got.map(eventKey)).size).toBe(250);
		expect(fetchPage.mock.calls.map((c) => c[0].offset)).toEqual([0, EVENT_PAGE_SIZE]);
		expect(fetchPage.mock.calls[0]![0]).toMatchObject({ paged: 1, limit: EVENT_PAGE_SIZE });
	});

	it('genau eine volle Seite ohne weitere → ein Abruf', async () => {
		const fetchPage = vi.fn(pagedBackend(series(EVENT_PAGE_SIZE)));
		expect(await fetchWindow(fetchPage, { from: 'a', to: 'b' })).toHaveLength(EVENT_PAGE_SIZE);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('altes Backend ohne Paging (Array): eine Seite, volle Seite wird gemeldet', async () => {
		const warn = vi.fn();
		const fetchPage: EventPageFetcher = async ({ limit }) => series(limit);
		expect(await fetchWindow(fetchPage, { from: 'a', to: 'b' }, warn)).toHaveLength(
			EVENT_PAGE_SIZE
		);
		expect(warn).toHaveBeenCalledOnce();
	});

	it('harte Obergrenze: bricht nach MAX_EVENT_PAGES ab und meldet die Kürzung', async () => {
		const warn = vi.fn();
		const fetchPage: EventPageFetcher = async ({ offset, limit }) => ({
			items: series(limit),
			total: 1e9,
			offset,
			limit,
			hasMore: true
		});
		const got = await fetchWindow(fetchPage, { from: 'a', to: 'b' }, warn);
		expect(got).toHaveLength(MAX_EVENT_PAGES * EVENT_PAGE_SIZE);
		expect(warn).toHaveBeenCalledOnce();
	});
});

describe('fetchEventWindows', () => {
	it('führt mehrtägige Termine aus zwei Fenstern zusammen, Serien-Vorkommen bleiben getrennt', async () => {
		const byWindow: Record<string, BackendEvent[]> = {
			'2026-01-01': [ev('a'), ev('lang'), ev('s', '2026-06-29')],
			'2026-07-01': [ev('lang'), ev('s', '2026-07-06'), ev('b')]
		};
		const fetchPage: EventPageFetcher = (q) => pagedBackend(byWindow[q.from] ?? [])(q);
		const got = await fetchEventWindows(fetchPage, [
			{ from: '2026-01-01', to: '2026-06-30' },
			{ from: '2026-07-01', to: '2026-12-31' }
		]);
		expect(got.map(eventKey)).toEqual(['a', 'lang', 's~2026-06-29', 's~2026-07-06', 'b']);
	});
});
