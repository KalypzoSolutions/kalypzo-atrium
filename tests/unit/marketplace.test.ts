/**
 * Modul-Marktplatz: toleranter Parser des Index (Schema 1), Link-Prüfung, Größenlimit, Installationslink.
 */
import { describe, expect, it } from 'vitest';
import {
	githubUrl,
	installLinkFor,
	MARKETPLACE_MAX_BYTES,
	parseMarketplaceIndex,
	readLimited
} from '$lib/server/core/modules/install/marketplace';

const SOURCE = 'https://github.com/KalypzoSolutions/atrium-basic-modules/tree/main/modules';

function source(over: Record<string, unknown> = {}) {
	return {
		id: 'basic',
		name: 'Basis-Module',
		description: { de: 'Grundausstattung', en: 'Basics' },
		repository: 'https://github.com/KalypzoSolutions/atrium-basic-modules',
		source: SOURCE,
		ref: 'main',
		path: 'modules',
		publisher: { name: 'Kalypzo', url: 'https://kalypzo.de' },
		official: true,
		categories: ['organisation', 'finance'],
		tags: ['verein'],
		license: 'Apache-2.0',
		homepage: 'https://atrium.kalypzo.de',
		modules: [
			{
				id: 'members',
				name: { de: 'Mitglieder', en: 'Members' },
				description: { de: 'Mitgliederverwaltung', en: 'Member management' },
				source: `${SOURCE}/members`
			}
		],
		addedAt: '2026-11-01',
		...over
	};
}

function index(sources: unknown[], over: Record<string, unknown> = {}) {
	return {
		schema: 1,
		generatedAt: '2026-11-20T10:00:00.000Z',
		site: 'https://atrium.kalypzo.de',
		marketplace: {
			de: 'https://atrium.kalypzo.de/marktplatz',
			en: 'https://atrium.kalypzo.de/en/marketplace'
		},
		sources,
		...over
	};
}

describe('parseMarketplaceIndex', () => {
	it('liest einen gültigen Index vollständig', () => {
		const r = parseMarketplaceIndex(index([source()]));
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.index.generatedAt).toBe('2026-11-20T10:00:00.000Z');
		expect(r.index.marketplace.de).toBe('https://atrium.kalypzo.de/marktplatz');
		const s = r.index.sources[0]!;
		expect(s).toMatchObject({
			id: 'basic',
			source: SOURCE,
			ref: 'main',
			path: 'modules',
			official: true,
			categories: ['organisation', 'finance'],
			publisher: { name: 'Kalypzo', url: 'https://kalypzo.de/' },
			addedAt: '2026-11-01'
		});
		expect(s.modules).toEqual([
			{
				id: 'members',
				name: { de: 'Mitglieder', en: 'Members' },
				description: { de: 'Mitgliederverwaltung', en: 'Member management' },
				source: `${SOURCE}/members`
			}
		]);
	});

	it('ignoriert unbekannte Felder und ordnet unbekannte Kategorien „other“ zu', () => {
		const r = parseMarketplaceIndex(
			index([source({ rating: 5, categories: ['finance', 'gaming', 'quantum'] })], { extra: true })
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.index).not.toHaveProperty('extra');
		expect(r.index.sources[0]).not.toHaveProperty('rating');
		expect(r.index.sources[0]!.categories).toEqual(['finance', 'other']);
	});

	it('überspringt kaputte Einträge statt alles zu verwerfen', () => {
		const r = parseMarketplaceIndex(
			index([
				source({ id: 'ok' }),
				null,
				'text',
				source({ id: 'ohne-name', name: '' }),
				source({ id: 'ohne-publisher', publisher: null }),
				source({ id: 'ok' }), // doppelt
				source({
					id: 'teilweise',
					modules: [
						{ id: 'X_ungültig', name: 'x', source: `${SOURCE}/x` },
						{ id: 'gut', name: 'Gut', source: `${SOURCE}/gut` },
						{ id: 'fremd', name: 'Fremd', source: 'https://gitlab.com/a/b' }
					]
				})
			])
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.index.sources.map((s) => s.id)).toEqual(['ok', 'teilweise']);
		const t = r.index.sources[1]!;
		expect(t.modules.map((m) => m.id)).toEqual(['gut']);
		// Ein Text statt { de, en } gilt für beide Sprachen
		expect(t.modules[0]!.name).toEqual({ de: 'Gut', en: 'Gut' });
	});

	it('verwirft Nicht-GitHub- und Nicht-https-Links', () => {
		const r = parseMarketplaceIndex(
			index([
				source({ id: 'gitlab', source: 'https://gitlab.com/a/b' }),
				source({ id: 'http', source: 'http://github.com/a/b' }),
				source({ id: 'nur-owner', source: 'https://github.com/a' }),
				source({ id: 'zugang', source: 'https://user:pw@github.com/a/b' }),
				source({ id: 'repo-http', repository: 'http://example.org' }),
				source({
					id: 'homepage',
					homepage: 'javascript:alert(1)',
					publisher: { name: 'X', url: 'http://x' }
				})
			])
		);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.index.sources.map((s) => s.id)).toEqual(['homepage']);
		expect(r.index.sources[0]!.homepage).toBeNull();
		expect(r.index.sources[0]!.publisher.url).toBeNull();
	});

	it('schema ≠ 1 ist inkompatibel, Unsinn ist ungültig', () => {
		expect(parseMarketplaceIndex(index([], { schema: 2 }))).toEqual({
			ok: false,
			reason: 'incompatible'
		});
		expect(parseMarketplaceIndex({ sources: [] })).toEqual({ ok: false, reason: 'invalid' });
		expect(parseMarketplaceIndex([])).toEqual({ ok: false, reason: 'invalid' });
		expect(parseMarketplaceIndex('x')).toEqual({ ok: false, reason: 'invalid' });
	});

	it('verlangt eine Quellen-Liste', () => {
		expect(parseMarketplaceIndex({ schema: 1 })).toEqual({ ok: false, reason: 'invalid' });
		expect(parseMarketplaceIndex({ schema: 1, sources: 'defekt' })).toEqual({
			ok: false,
			reason: 'invalid'
		});
		expect(parseMarketplaceIndex({ schema: 1, sources: [] }).ok).toBe(true);
	});
});

describe('githubUrl', () => {
	it('akzeptiert nur github.com mit owner/repo', () => {
		expect(githubUrl('https://github.com/a/b')).toBe('https://github.com/a/b');
		expect(githubUrl(SOURCE)).toBe(SOURCE);
		expect(githubUrl('https://github.com.evil.example/a/b')).toBeNull();
		expect(githubUrl('https://github.com:8443/a/b')).toBeNull();
		expect(githubUrl(42)).toBeNull();
	});
});

describe('readLimited', () => {
	it('liest bis zur Grenze und bricht darüber ab', async () => {
		expect(await readLimited(new Response('{"a":1}'))).toBe('{"a":1}');
		const big = new Uint8Array(MARKETPLACE_MAX_BYTES + 1);
		await expect(readLimited(new Response(big))).rejects.toThrow('tooLarge');
		// Streaming ohne content-length
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				for (let i = 0; i < 3; i++) c.enqueue(new Uint8Array(1024 * 1024));
				c.close();
			}
		});
		await expect(readLimited(new Response(stream))).rejects.toThrow('tooLarge');
	});

	it('lehnt einen zu großen content-length sofort ab', async () => {
		const res = new Response('{}', { headers: { 'content-length': String(10 * 1024 * 1024) } });
		await expect(readLimited(res)).rejects.toThrow('tooLarge');
	});
});

describe('installLinkFor', () => {
	it('baut den Link in den Installations-Assistenten', () => {
		expect(installLinkFor(SOURCE)).toBe(
			`/admin/modules/install?url=${encodeURIComponent(SOURCE).replace(/%20/g, '+')}`
		);
		const withSel = new URL(installLinkFor(SOURCE, 'members'), 'http://x');
		expect(withSel.pathname).toBe('/admin/modules/install');
		expect(withSel.searchParams.get('url')).toBe(SOURCE);
		expect(withSel.searchParams.get('select')).toBe('members');
	});
});
