/**
 * Stammeswebsite: Wiederholung vorübergehender Backend-Fehler (`website/src/lib/server/retry.ts`, rein).
 */
import { describe, expect, it, vi } from 'vitest';
import {
	fetchWithRetry,
	isTransientStatus,
	retryAfterMs
} from '../../website/src/lib/server/retry';

const ok = () => new Response('{"data":1}', { status: 200 });
const status = (s: number, headers?: Record<string, string>) =>
	new Response('x', { status: s, headers });

function setup(results: (Response | Error)[]) {
	const sleeps: number[] = [];
	const doFetch = vi.fn(async () => {
		const next = results.shift();
		if (!next) throw new Error('keine Antwort mehr');
		if (next instanceof Error) throw next;
		return next;
	});
	const options = { delays: [300, 1000], sleep: async (ms: number) => void sleeps.push(ms) };
	return { doFetch, options, sleeps };
}

describe('fetchWithRetry', () => {
	it('Netzwerkfehler (geschlossene Keep-alive-Verbindung) → erneut, dann Erfolg', async () => {
		const { doFetch, options, sleeps } = setup([new TypeError('fetch failed'), ok()]);
		const res = await fetchWithRetry(doFetch, options);
		expect(res.status).toBe(200);
		expect(doFetch).toHaveBeenCalledTimes(2);
		expect(sleeps).toEqual([300]);
	});

	it('503 beim Neustart → bis zu zwei Wiederholungen', async () => {
		const { doFetch, options, sleeps } = setup([status(503), status(502), ok()]);
		expect((await fetchWithRetry(doFetch, options)).status).toBe(200);
		expect(sleeps).toEqual([300, 1000]);
	});

	it('nach allen Versuchen: letzte Antwort bzw. letzter Fehler', async () => {
		const a = setup([status(503), status(503), status(503)]);
		expect((await fetchWithRetry(a.doFetch, a.options)).status).toBe(503);
		expect(a.doFetch).toHaveBeenCalledTimes(3);
		const b = setup([new Error('a'), new Error('b'), new Error('timeout')]);
		await expect(fetchWithRetry(b.doFetch, b.options)).rejects.toThrow('timeout');
	});

	it('404/422/500 werden nicht wiederholt', async () => {
		for (const s of [404, 422, 500, 403]) {
			const { doFetch, options } = setup([status(s), ok()]);
			expect((await fetchWithRetry(doFetch, options)).status).toBe(s);
			expect(doFetch).toHaveBeenCalledTimes(1);
		}
	});

	it('429 mit Retry-After: wartet so lange, höchstens 2 s', async () => {
		const a = setup([status(429, { 'retry-after': '1' }), ok()]);
		await fetchWithRetry(a.doFetch, a.options);
		expect(a.sleeps).toEqual([1000]);
		const b = setup([status(429, { 'retry-after': '60' }), ok()]);
		await fetchWithRetry(b.doFetch, b.options);
		expect(b.sleeps).toEqual([2000]);
	});
});

describe('Hilfen', () => {
	it('vorübergehende Status', () => {
		expect([408, 429, 502, 503, 504].every(isTransientStatus)).toBe(true);
		expect([200, 400, 404, 422, 500].some(isTransientStatus)).toBe(false);
	});

	it('Retry-After als Sekunden oder Datum', () => {
		expect(retryAfterMs('3')).toBe(3000);
		expect(retryAfterMs(null)).toBeNull();
		expect(retryAfterMs('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('2026-10-21T07:28:00Z'))).toBe(
			10_000
		);
		expect(retryAfterMs('quatsch')).toBeNull();
	});
});
