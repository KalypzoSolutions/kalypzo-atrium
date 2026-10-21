/**
 * Stammeswebsite (#20): Cache mit negativem Cache und In-Flight-Deduplizierung, Bild-Cache, Rate-Limit je IP
 * (`website/src/lib/server/cache.ts`, `image-cache.ts`, rein). Liegt in der Root-Suite, weil `website/` kein Vitest hat.
 */
import { describe, expect, it } from 'vitest';
import {
	EVENT_KEY_RE,
	SLUG_RE,
	UUID_RE,
	createCachedLoader,
	createRateLimiter
} from '../../website/src/lib/server/cache';
import {
	createImageCache,
	imageResponse,
	readImage,
	ImageUpstreamError
} from '../../website/src/lib/server/image-cache';

class NotFound extends Error {}

function clock(start = 1_000_000) {
	let t = start;
	return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createCachedLoader', () => {
	it('legt gleichzeitige Abrufe zusammen und hält Erfolge bis zum Ablauf', async () => {
		const c = clock();
		const cache = createCachedLoader<number>({
			ttlMs: 60_000,
			negativeTtlMs: 60_000,
			maxEntries: 10,
			now: c.now
		});
		let calls = 0;
		const load = async () => {
			calls++;
			await new Promise((r) => setTimeout(r, 5));
			return 42;
		};
		const results = await Promise.all(Array.from({ length: 10 }, () => cache.get('a', load)));
		expect(results).toEqual(Array(10).fill(42));
		expect(calls).toBe(1);
		await cache.get('a', load);
		expect(calls).toBe(1);
		c.advance(60_001);
		await cache.get('a', load);
		expect(calls).toBe(2);
	});

	it('merkt negative Antworten (1000 Anfragen auf dieselbe unbekannte ID → 1 Abruf)', async () => {
		const c = clock();
		const cache = createCachedLoader<number>({
			ttlMs: 60_000,
			negativeTtlMs: 30_000,
			maxEntries: 10,
			isNegative: (e) => e instanceof NotFound,
			now: c.now
		});
		let calls = 0;
		const load = async () => {
			calls++;
			throw new NotFound();
		};
		for (let i = 0; i < 1000; i++)
			await expect(cache.get('x', load)).rejects.toBeInstanceOf(NotFound);
		expect(calls).toBe(1);
		c.advance(30_001);
		await expect(cache.get('x', load)).rejects.toBeInstanceOf(NotFound);
		expect(calls).toBe(2);
	});

	it('liefert bei Ausfall den letzten Stand und fragt erst nach errorTtl neu', async () => {
		const c = clock();
		const cache = createCachedLoader<string>({
			ttlMs: 1000,
			negativeTtlMs: 1000,
			errorTtlMs: 5000,
			maxEntries: 10,
			isNegative: (e) => e instanceof NotFound,
			now: c.now
		});
		await cache.get('k', async () => 'alt');
		c.advance(1001);
		let calls = 0;
		const failing = async () => {
			calls++;
			throw new Error('503');
		};
		expect(await cache.get('k', failing)).toBe('alt');
		expect(await cache.get('k', failing)).toBe('alt');
		expect(calls).toBe(1);
		c.advance(5001);
		expect(await cache.get('k', async () => 'neu')).toBe('neu');
	});

	it('verwirft den alten Stand bei 404 (Objekt nicht mehr öffentlich)', async () => {
		const c = clock();
		const cache = createCachedLoader<string>({
			ttlMs: 1000,
			negativeTtlMs: 1000,
			maxEntries: 10,
			isNegative: (e) => e instanceof NotFound,
			now: c.now
		});
		await cache.get('k', async () => 'alt');
		c.advance(1001);
		await expect(
			cache.get('k', async () => {
				throw new NotFound();
			})
		).rejects.toBeInstanceOf(NotFound);
	});

	it('Fehler ohne alten Stand werden kurz gemerkt (keine Stampede auf ein ausgefallenes Backend)', async () => {
		const c = clock();
		const cache = createCachedLoader<string>({
			ttlMs: 1000,
			negativeTtlMs: 1000,
			errorTtlMs: 5000,
			maxEntries: 10,
			now: c.now
		});
		let calls = 0;
		const failing = async () => {
			calls++;
			throw new Error('down');
		};
		for (let i = 0; i < 20; i++) await expect(cache.get('k', failing)).rejects.toThrow('down');
		expect(calls).toBe(1);
	});

	it('begrenzt nach Anzahl und Bytes (LRU), zu große Werte werden nicht gespeichert', async () => {
		const cache = createCachedLoader<Uint8Array>({
			ttlMs: 60_000,
			negativeTtlMs: 1000,
			maxEntries: 100,
			maxBytes: 1000,
			sizeOf: (v) => v.byteLength
		});
		for (let i = 0; i < 10; i++) await cache.get(`b${i}`, async () => new Uint8Array(200));
		expect(cache.bytes).toBeLessThanOrEqual(1000);
		expect(cache.size).toBe(5);
		await cache.get('gross', async () => new Uint8Array(251));
		expect(cache.size).toBe(5);
		let calls = 0;
		await cache.get('b9', async () => (calls++, new Uint8Array(1)));
		expect(calls).toBe(0); // jüngster Eintrag noch da
		await cache.get('b0', async () => (calls++, new Uint8Array(1)));
		expect(calls).toBe(1); // ältester verdrängt
	});
});

describe('Bild-Cache', () => {
	const png = (bytes = 10) =>
		new Response(new Uint8Array(bytes), {
			headers: { 'content-type': 'image/webp', 'content-length': String(bytes) }
		});

	it('10 parallele Erstaufrufe je Bild → 1 Backend-Abruf; 404 wird kurz gemerkt', async () => {
		const c = clock();
		const cache = createImageCache({
			ttlMs: 3_600_000,
			notFoundTtlMs: 60_000,
			maxBytes: 10_000_000,
			now: c.now
		});
		const calls = new Map<string, number>();
		const fetchImage = async (id: string) => {
			calls.set(id, (calls.get(id) ?? 0) + 1);
			await new Promise((r) => setTimeout(r, 2));
			return id === 'fehlt' ? null : png();
		};
		const ids = Array.from({ length: 200 }, (_, i) => `img${i}`);
		await Promise.all(
			Array.from({ length: 10 }, () =>
				Promise.all(ids.map((id) => cache.get(id, async () => readImage(await fetchImage(id)))))
			)
		);
		expect([...calls.values()].every((n) => n === 1)).toBe(true);
		expect(calls.size).toBe(200);
		for (let i = 0; i < 50; i++) {
			expect(await cache.get('fehlt', async () => readImage(await fetchImage('fehlt')))).toBeNull();
		}
		expect(calls.get('fehlt')).toBe(1);
		c.advance(60_001);
		await cache.get('fehlt', async () => readImage(await fetchImage('fehlt')));
		expect(calls.get('fehlt')).toBe(2);
	});

	it('prüft Typ und Größe der Backend-Antwort', async () => {
		await expect(
			readImage(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }))
		).rejects.toBeInstanceOf(ImageUpstreamError);
		await expect(
			readImage(new Response('x', { headers: { 'content-type': 'text/html' } }))
		).rejects.toBeInstanceOf(ImageUpstreamError);
		await expect(
			readImage(
				new Response('x', {
					headers: { 'content-type': 'image/png', 'content-length': String(20 * 1024 * 1024) }
				})
			)
		).rejects.toBeInstanceOf(ImageUpstreamError);
		expect(await readImage(null)).toBeNull();
	});

	it('liefert ETag, Cache-Control und 304 bei passendem If-None-Match', async () => {
		const img = (await readImage(png(5)))!;
		const first = imageResponse(img, new Request('http://x/bild'));
		expect(first.status).toBe(200);
		expect(first.headers.get('etag')).toBe(img.etag);
		expect(first.headers.get('cache-control')).toContain('max-age=86400');
		expect(first.headers.get('x-content-type-options')).toBe('nosniff');
		expect(first.headers.get('content-type')).toBe('image/webp');
		const again = imageResponse(
			img,
			new Request('http://x/bild', { headers: { 'if-none-match': img.etag } })
		);
		expect(again.status).toBe(304);
	});
});

describe('Rate-Limit je IP', () => {
	it('erlaubt bis zum Limit, danach 429 mit Retry-After, neues Fenster nach Ablauf', () => {
		const c = clock();
		const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: c.now });
		expect([1, 2, 3].map(() => rl.hit('1.2.3.4').allowed)).toEqual([true, true, true]);
		const blocked = rl.hit('1.2.3.4');
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSec).toBe(60);
		expect(rl.hit('5.6.7.8').allowed).toBe(true);
		c.advance(60_000);
		expect(rl.hit('1.2.3.4').allowed).toBe(true);
	});

	it('hält höchstens maxKeys Schlüssel', () => {
		const rl = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100 });
		for (let i = 0; i < 1000; i++) rl.hit(`ip${i}`);
		expect(rl.size).toBeLessThanOrEqual(100);
	});
});

describe('ID-Prüfung', () => {
	it('lässt nur gültige Formen durch', () => {
		const id = '0b9c3a52-6f1e-4c7a-9d1e-2a3b4c5d6e7f';
		expect(UUID_RE.test(id)).toBe(true);
		expect(UUID_RE.test('abc')).toBe(false);
		expect(UUID_RE.test(`${id}/../x`)).toBe(false);
		expect(EVENT_KEY_RE.test(id)).toBe(true);
		expect(EVENT_KEY_RE.test(`${id}~2026-10-21`)).toBe(true);
		expect(EVENT_KEY_RE.test(`${id}~morgen`)).toBe(false);
		expect(SLUG_RE.test('sportliche-panther')).toBe(true);
		expect(SLUG_RE.test('Sportliche Panther')).toBe(false);
	});
});
