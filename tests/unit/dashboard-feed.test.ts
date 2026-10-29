import { describe, expect, it } from 'vitest';
import { dueLabel, feedFinding, shortDate } from '../../src/lib/components/dashboard/feed-data';
import {
	mondayOf,
	sortAgenda,
	sortTodos,
	withoutDuplicateMeetings
} from '../../src/lib/server/core/dashboard/feed';
import type { DashboardFeedAgendaItem, DashboardFeedTodo } from '../../src/lib/sdk/types/dashboard';

const todo = (title: string, extra: Partial<DashboardFeedTodo> = {}): DashboardFeedTodo => ({
	id: title,
	moduleId: 'm',
	moduleName: 'M',
	title,
	severity: 'due',
	action: { label: 'Öffnen', href: '/x' },
	...extra
});
const item = (
	title: string,
	extra: Partial<DashboardFeedAgendaItem> = {}
): DashboardFeedAgendaItem => ({
	id: title,
	moduleId: 'm',
	kind: 'event',
	title,
	date: '2026-10-29',
	href: '/x',
	...extra
});

describe('mondayOf', () => {
	it('liefert den Montag der Woche (Sonntag gehört zur Vorwoche)', () => {
		expect(mondayOf('2026-10-29')).toBe('2026-10-26'); // Donnerstag
		expect(mondayOf('2026-10-26')).toBe('2026-10-26'); // Montag
		expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // Sonntag
		expect(mondayOf('2027-01-01')).toBe('2026-12-28'); // über den Jahreswechsel
	});
});

describe('sortTodos', () => {
	it('überfällig zuerst, dann Frist (ohne Frist zuletzt), dann Titel', () => {
		const sorted = sortTodos([
			todo('Hinweis', { severity: 'info', due: '2026-10-01' }),
			todo('Ohne Frist'),
			todo('Später', { due: '2026-11-09' }),
			todo('Bald', { due: '2026-10-30' }),
			todo('Alt', { severity: 'overdue', due: '2026-10-20' })
		]);
		expect(sorted.map((t) => t.title)).toEqual(['Alt', 'Bald', 'Später', 'Ohne Frist', 'Hinweis']);
	});
});

describe('sortAgenda', () => {
	it('nach Tag, ganztägig vor Uhrzeit', () => {
		const sorted = sortAgenda([
			item('Abend', { startTime: '19:30' }),
			item('Morgen', { date: '2026-10-30' }),
			item('Ganztag'),
			item('Früh', { startTime: '08:00' })
		]);
		expect(sorted.map((a) => a.title)).toEqual(['Ganztag', 'Früh', 'Abend', 'Morgen']);
	});
});

describe('withoutDuplicateMeetings', () => {
	it('entfernt Gruppenstunden, die am selben Tag als Termin gleichen Titels sichtbar sind', () => {
		const out = withoutDuplicateMeetings([
			item('Gruppenstunde Wölflinge', { kind: 'meeting', id: 'm1' }),
			item('gruppenstunde  wölflinge', { id: 'e1' }),
			item('Gruppenstunde Wölflinge', { kind: 'meeting', id: 'm2', date: '2026-11-03' }),
			item('Gruppenstunde Kranich', { kind: 'meeting', id: 'm3' })
		]);
		expect(out.map((a) => a.id)).toEqual(['e1', 'm2', 'm3']);
	});

	it('erkennt Gruppenstunden auch über Gruppe + Startzeit (Termin ohne passenden Titel)', () => {
		const out = withoutDuplicateMeetings([
			item('Gruppenstunde Kranich', {
				kind: 'meeting',
				id: 'm1',
				startTime: '18:00',
				groupIds: ['g1']
			}),
			item('Sippenstunde', { id: 'e1', startTime: '18:00', groupIds: ['g1', 'g2'] }),
			item('Gruppenstunde Wölflinge', {
				kind: 'meeting',
				id: 'm2',
				startTime: '16:30',
				groupIds: ['g2']
			})
		]);
		expect(out.map((a) => a.id)).toEqual(['e1', 'm2']);
	});
});

describe('feed-data', () => {
	it('shortDate und dueLabel', () => {
		expect(shortDate('2026-11-02')).toBe('2.11.');
		expect(dueLabel('2026-10-20', '2026-10-29')).toBe('seit 20.10. überfällig');
		expect(dueLabel('2026-10-29', '2026-10-29')).toBe('heute fällig');
		expect(dueLabel('2026-10-30', '2026-10-29')).toBe('morgen fällig');
		expect(dueLabel('2026-11-02', '2026-10-29')).toBe('bis 2.11.');
		expect(dueLabel(null, '2026-10-29')).toBe('');
	});

	it('feedFinding nennt das Wichtigste', () => {
		const today = '2026-10-29';
		expect(feedFinding([], today)).toBeNull();
		expect(feedFinding([todo('A')], today)).toBe('Eine Sache steht an, nichts ist überfällig.');
		expect(feedFinding([todo('A'), todo('B', { severity: 'info' })], today)).toBe(
			'2 Dinge stehen an, nichts ist überfällig.'
		);
		expect(
			feedFinding([todo('Rechnung bezahlen', { severity: 'overdue', due: '2026-10-20' })], today)
		).toBe('Rechnung bezahlen: seit 9 Tagen überfällig.');
		expect(feedFinding([todo('Antrag', { severity: 'overdue', due: '2026-10-28' })], today)).toBe(
			'Antrag: seit gestern überfällig.'
		);
		expect(
			feedFinding(
				[
					todo('A', { severity: 'overdue', due: '2026-10-27' }),
					todo('B', { severity: 'overdue', due: '2026-10-20' })
				],
				today
			)
		).toBe('2 Dinge sind überfällig, das älteste seit 9 Tagen.');
	});
});
