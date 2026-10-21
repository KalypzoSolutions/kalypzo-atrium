import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hit, peek, resetAllForTests } from '../../src/lib/server/core/rate-limit';

// #67 (01a-09): Das globale Aufräumen darf Buckets mit langem Fenster nicht auf das Fenster
// fremder, kurzer Aufrufe kürzen.
describe('rate-limit', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
		resetAllForTests();
	});
	afterEach(() => {
		vi.useRealTimers();
		resetAllForTests();
	});

	it('zählt im Fenster und blockiert ab dem Limit', () => {
		expect(hit('a', 2, 60)).toMatchObject({ allowed: true, remaining: 1 });
		expect(hit('a', 2, 60)).toMatchObject({ allowed: true, remaining: 0 });
		const blocked = hit('a', 2, 60);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSec).toBe(60);
		vi.advanceTimersByTime(60_001);
		expect(hit('a', 2, 60).allowed).toBe(true);
	});

	it('Treffer mit 3600-s-Fenster bleiben nach 16 min fremder Treffer (60-s-Fenster) erhalten', () => {
		for (let i = 0; i < 3; i++) expect(hit('email-change:u1', 3, 3600).allowed).toBe(true);
		// 16 Minuten lang jede Minute ein fremder Treffer mit kurzem Fenster → mehrfaches Aufräumen
		for (let m = 0; m < 16; m++) {
			vi.advanceTimersByTime(60_000);
			hit(`other:${m}`, 100, 60);
		}
		expect(peek('email-change:u1', 3600)).toBe(3);
		expect(hit('email-change:u1', 3, 3600).allowed).toBe(false);
		// Nach Ablauf der Stunde ist wieder frei
		vi.advanceTimersByTime(45 * 60_000);
		hit('other:late', 100, 60);
		expect(hit('email-change:u1', 3, 3600).allowed).toBe(true);
	});

	it('räumt abgelaufene kurze Buckets auf', () => {
		hit('short', 5, 60);
		vi.advanceTimersByTime(16 * 60_000);
		hit('trigger', 5, 60);
		expect(peek('short', 3600)).toBe(0);
	});
});
