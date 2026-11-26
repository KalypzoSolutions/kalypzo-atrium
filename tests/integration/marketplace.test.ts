/**
 * Modul-Marktplatz gegen PGlite und einen Fetch-Ersatz: Abruf speichert die letzte gültige Fassung, bei Ausfall
 * bleibt sie als „stale“ erhalten, ohne Fassung „unreachable“ – nie ein Wurf. Dazu leere URL, ETag/304, Schema 2,
 * Weiterleitungen, gemeinsamer Abruf und der Core-Job.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { actions } from '../../src/routes/(internal)/admin/modules/marketplace/+page.server';
import { listJobs, runJobNow } from '$lib/server/core/jobs';
import { setSetting } from '$lib/server/core/settings/service';
import {
	getMarketplace,
	refreshMarketplace,
	resetMarketplaceCacheForTests,
	setMarketplaceFetchForTests
} from '$lib/server/core/modules/install/marketplace';
import type { RequestContext } from '$lib/sdk/types';

const URL_DEFAULT = 'https://atrium.kalypzo.de/marketplace/v1/index.json';
let close: () => Promise<void>;
let admin: RequestContext;

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;
let handler: Handler;
const calls: { url: string; headers: Record<string, string> }[] = [];

function body(sources = 1, schemaVersion = 1) {
	return JSON.stringify({
		schema: schemaVersion,
		generatedAt: '2026-11-20T10:00:00Z',
		site: 'https://atrium.kalypzo.de',
		marketplace: { de: 'https://atrium.kalypzo.de/marktplatz', en: 'https://atrium.kalypzo.de/en' },
		sources: Array.from({ length: sources }, (_, i) => ({
			id: `src-${i}`,
			name: `Quelle ${i}`,
			description: { de: 'Beschreibung', en: 'Description' },
			repository: 'https://github.com/KalypzoSolutions/atrium-basic-modules',
			source: 'https://github.com/KalypzoSolutions/atrium-basic-modules/tree/main/modules',
			publisher: { name: 'Kalypzo' },
			official: true,
			categories: ['other'],
			tags: [],
			modules: [],
			addedAt: '2026-11-01'
		}))
	});
}

const ok = (text: string, etag = '"v1"') =>
	new Response(text, { status: 200, headers: { 'content-type': 'application/json', etag } });

async function cacheRow() {
	const [row] = await getDb()
		.select()
		.from(schema.marketplaceCache)
		.where(eq(schema.marketplaceCache.url, URL_DEFAULT));
	return row;
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@test.local', 'Sehr-Sicheres-Passwort-1');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@test.local'));
	admin = (await contextForUser(u!.id))!.ctx;
	setMarketplaceFetchForTests(async (url, init) => {
		calls.push({ url, headers: { ...(init.headers as Record<string, string>) } });
		return handler(url, init);
	});
});

afterAll(async () => {
	setMarketplaceFetchForTests(null);
	await close();
});

beforeEach(async () => {
	calls.length = 0;
	resetMarketplaceCacheForTests();
	await getDb().execute(sql`DELETE FROM marketplace_cache`);
	await setSetting(admin, 'core.modules.marketplaceUrl', URL_DEFAULT);
	handler = () => ok(body());
});

describe('Marktplatz', () => {
	it('ohne Cache und ohne Erreichbarkeit: „unreachable“ ohne Wurf', async () => {
		handler = () => {
			throw new TypeError('fetch failed');
		};
		const s = await getMarketplace();
		expect(s).toMatchObject({
			status: 'unreachable',
			index: null,
			fetchedAt: null,
			url: URL_DEFAULT
		});
		expect(s.error).toBeTruthy();
		expect(s.lastAttemptAt).not.toBeNull();
		expect(await cacheRow()).toBeUndefined();
	});

	it('erfolgreicher Abruf speichert die Fassung; danach Ausfall → „stale“ mit alter Fassung', async () => {
		const first = await refreshMarketplace();
		expect(first.status).toBe('ok');
		expect(first.index?.sources).toHaveLength(1);
		// keine personen- oder instanzbezogenen Daten im Request
		expect(calls[0]!.headers).toEqual({
			accept: 'application/json',
			'user-agent': 'kalypzo-atrium'
		});
		const row = await cacheRow();
		expect(row?.etag).toBe('"v1"');
		expect(row?.lastError).toBeNull();

		// Neuer Prozess: liest aus der DB, Abruf hängt bzw. wirft
		resetMarketplaceCacheForTests();
		handler = () => {
			throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
		};
		const s = await refreshMarketplace();
		expect(s.status).toBe('stale');
		expect(s.index?.sources[0]?.id).toBe('src-0');
		expect(s.fetchedAt).toBe(first.fetchedAt);
		expect((await cacheRow())?.lastError).toBe('timeout');
	});

	it('getMarketplace wartet höchstens waitMs und liefert sonst den Cache', async () => {
		await refreshMarketplace();
		// Cache künstlich altern lassen (neuer Prozess liest aus der DB)
		await getDb().execute(sql`UPDATE marketplace_cache SET fetched_at = now() - interval '1 hour'`);
		resetMarketplaceCacheForTests();
		let release: () => void = () => {};
		handler = () =>
			new Promise<Response>((resolve) => {
				release = () => resolve(ok(body(3), '"v2"'));
			});
		const quick = await getMarketplace({ waitMs: 20 });
		expect(quick.index?.sources).toHaveLength(1);
		// Aktualisierung läuft weiter und teilt sich das Promise
		const again = getMarketplace({ refresh: true, waitMs: 5000 });
		release();
		expect((await again).index?.sources).toHaveLength(3);
		expect(calls).toHaveLength(2);
	});

	it('frischer Cache wird ohne Abruf geliefert', async () => {
		await refreshMarketplace();
		calls.length = 0;
		const s = await getMarketplace();
		expect(s.status).toBe('ok');
		expect(calls).toHaveLength(0);
	});

	it('nutzt ETag und frischt bei 304 auf', async () => {
		await refreshMarketplace();
		handler = (_u, init) => {
			const h = init.headers as Record<string, string>;
			return h['if-none-match'] === '"v1"'
				? new Response(null, { status: 304 })
				: ok(body(5), '"v9"');
		};
		const s = await refreshMarketplace();
		expect(calls[1]!.headers['if-none-match']).toBe('"v1"');
		expect(s.status).toBe('ok');
		expect(s.index?.sources).toHaveLength(1);
	});

	it('Schema 2 → „incompatible“, gespeicherte Fassung bleibt', async () => {
		await refreshMarketplace();
		handler = () => ok(body(4, 2));
		const s = await refreshMarketplace();
		expect(s.status).toBe('incompatible');
		expect(s.index?.sources).toHaveLength(1);
		expect((await cacheRow())?.lastError).toBe('incompatible');
	});

	it('ungültige Quellenliste erhält den gespeicherten Cache', async () => {
		await refreshMarketplace();
		const before = await cacheRow();
		handler = () => ok(JSON.stringify({ schema: 1, sources: 'defekt' }));
		const result = await refreshMarketplace();
		expect(result.status).toBe('stale');
		expect(result.index?.sources).toHaveLength(1);
		expect(await cacheRow()).toMatchObject({
			data: before?.data,
			etag: before?.etag,
			lastError: 'invalid'
		});
	});

	it('leere URL → „disabled“ ohne Abruf', async () => {
		await setSetting(admin, 'core.modules.marketplaceUrl', '');
		expect((await getMarketplace()).status).toBe('disabled');
		expect((await refreshMarketplace()).status).toBe('disabled');
		expect(calls).toHaveLength(0);
	});

	it('Einstellung nimmt nur https-Adressen', async () => {
		await expect(
			setSetting(admin, 'core.modules.marketplaceUrl', 'http://example.org/index.json')
		).rejects.toMatchObject({ status: 422 });
	});

	it('folgt Weiterleitungen nur auf https', async () => {
		handler = (url) =>
			url === URL_DEFAULT
				? new Response(null, { status: 302, headers: { location: 'http://evil.example/x.json' } })
				: ok(body());
		const s = await refreshMarketplace();
		expect(s.status).toBe('unreachable');
		expect(calls).toHaveLength(1);

		handler = (url) =>
			url === URL_DEFAULT
				? new Response(null, { status: 301, headers: { location: '/marketplace/v1/neu.json' } })
				: ok(body(2));
		const t = await refreshMarketplace();
		expect(t.status).toBe('ok');
		expect(calls.at(-1)!.url).toBe('https://atrium.kalypzo.de/marketplace/v1/neu.json');
	});

	it('HTTP-Fehler und ungültiges JSON werfen nicht', async () => {
		handler = () => new Response('nope', { status: 503 });
		expect((await refreshMarketplace()).status).toBe('unreachable');
		handler = () => ok('{kaputt');
		expect((await refreshMarketplace()).status).toBe('unreachable');
	});

	it('begrenzt Job und Refresh-Aktion auch bei einem hängenden Body', async () => {
		handler = () => new Response(new ReadableStream({ start() {} }));
		const start = Date.now();
		await runJobNow(admin, 'core.marketplace-refresh');
		expect(Date.now() - start).toBeLessThan(3000);
		const actionStart = Date.now();
		await actions.refresh!({ locals: { ctx: admin, user: { id: admin.userId } } } as Parameters<
			NonNullable<typeof actions.refresh>
		>[0]);
		expect(Date.now() - actionStart).toBeLessThan(3000);
	}, 10000);

	it('Core-Job läuft ohne Wurf, auch wenn die Website fehlt', async () => {
		const job = (await listJobs()).find((j) => j.key === 'core.marketplace-refresh');
		expect(job).toMatchObject({ moduleId: 'core', schedule: 'hourly', enabled: true });
		handler = () => {
			throw new TypeError('fetch failed');
		};
		const failed = await runJobNow(admin, 'core.marketplace-refresh');
		expect(failed.lastStatus).toBe('ok');
		expect(failed.lastMessage).toBeTruthy();
		handler = () => ok(body(2));
		const done = await runJobNow(admin, 'core.marketplace-refresh');
		expect(done.lastStatus).toBe('ok');
		expect(done.lastMessage).toMatch(/2/);
	});
});
