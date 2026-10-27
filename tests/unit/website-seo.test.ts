/**
 * Stammeswebsite: Suchmaschinen-Hilfen – JSON-LD (`website/src/lib/seo.ts`), robots.txt, sitemap.xml, llms.txt
 * (`website/src/lib/server/discovery.ts`) und Gzip (`website/src/lib/server/compress.ts`).
 */
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	absoluteUrl,
	berlinOffset,
	blogPosting,
	breadcrumb,
	event,
	faqPage,
	jsonLdScript,
	organization,
	plainText,
	scheduleDate,
	serializeJsonLd
} from '../../website/src/lib/seo';
import {
	AI_CRAWLERS,
	BOT_TRAP_PATH,
	llmsTxt,
	robotsTxt,
	sitemapXml
} from '../../website/src/lib/server/discovery';
import {
	acceptsGzip,
	compressResponse,
	shouldCompress
} from '../../website/src/lib/server/compress';

const BASE = 'https://edelweisspiraten-bremen.de';

describe('JSON-LD', () => {
	it('maskiert < > & und Zeilentrenner, bleibt gültiges JSON', () => {
		const evil = { name: '</script><script>alert(1)</script> & \u2028x' };
		const text = serializeJsonLd(evil);
		expect(text).not.toContain('<');
		expect(text).not.toContain('>');
		expect(text).not.toContain('&');
		expect(text).not.toContain('\u2028');
		expect(JSON.parse(text)).toEqual(evil);
		const tag = jsonLdScript(evil);
		expect(tag.startsWith('<script type="application/ld+json">')).toBe(true);
		expect(tag.match(/<\/script>/g)).toHaveLength(1);
	});

	it('Organisation mit Adresse und Treffpunkt', () => {
		const org = organization(`${BASE}/`);
		expect(org).toMatchObject({
			'@type': 'Organization',
			'@id': `${BASE}/#organisation`,
			name: 'Stamm Edelweißpiraten',
			url: `${BASE}/`,
			logo: `${BASE}/logo.avif`,
			address: {
				streetAddress: 'Drakenburger Str. 42',
				postalCode: '28207',
				addressLocality: 'Bremen'
			},
			location: { name: 'Ev. Kirchengemeinde Bremen-Hastedt' }
		});
	});

	it('Brotkrümel mit Positionen und absoluten Adressen', () => {
		const b = breadcrumb(BASE, [
			{ name: 'Start', path: '/' },
			{ name: 'Blog', path: '/blog' }
		]) as { itemListElement: { position: number; item: string }[] };
		expect(b.itemListElement.map((i) => [i.position, i.item])).toEqual([
			[1, `${BASE}/`],
			[2, `${BASE}/blog`]
		]);
	});

	it('Zeitzone Europe/Berlin (Sommer/Winter) und Termin', () => {
		expect(berlinOffset('2026-07-01')).toBe('+02:00');
		expect(berlinOffset('2026-12-01')).toBe('+01:00');
		expect(scheduleDate('2026-11-14', '16:30')).toBe('2026-11-14T16:30:00+01:00');
		expect(scheduleDate('2026-11-14', null)).toBe('2026-11-14');
		const e = event({
			base: BASE,
			path: '/termine/abc',
			title: 'Herbstfahrt',
			description: '<p>Wir fahren &amp; wandern</p>',
			startsOn: '2026-10-30',
			startsTime: '15:00',
			endsOn: '2026-11-01',
			endsTime: '14:00',
			location: null,
			image: '/bilder/galerie/x/y/thumb'
		});
		expect(e).toMatchObject({
			'@type': 'Event',
			url: `${BASE}/termine/abc`,
			startDate: '2026-10-30T15:00:00+01:00',
			endDate: '2026-11-01T14:00:00+01:00',
			description: 'Wir fahren & wandern',
			location: { '@type': 'Place', name: 'Ev. Kirchengemeinde Bremen-Hastedt' },
			image: [`${BASE}/bilder/galerie/x/y/thumb`]
		});
		const own = event({
			base: BASE,
			path: '/termine/b',
			title: 'Lager',
			startsOn: '2026-07-01',
			location: 'Zeltplatz Ahlhorn'
		});
		expect(own.location).toMatchObject({ name: 'Zeltplatz Ahlhorn' });
		expect(own.endDate).toBeUndefined();
	});

	it('FAQPage mit Klartext-Antworten, leere fallen weg', () => {
		const f = faqPage([
			{ question: 'Was kostet das?', answerHtml: '<p>47 € <strong>im Jahr</strong></p>' },
			{ question: 'Leer', answerHtml: '<p> </p>' }
		]) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
		expect(f.mainEntity).toEqual([
			{
				'@type': 'Question',
				name: 'Was kostet das?',
				acceptedAnswer: { '@type': 'Answer', text: '47 € im Jahr' }
			}
		]);
	});

	it('BlogPosting mit Autor (Vorname) bzw. Organisation', () => {
		const p = blogPosting({
			base: BASE,
			path: '/blog/sommerlager',
			title: 'Sommerlager',
			publishedAt: '2026-08-01T10:00:00.000Z',
			authorName: 'Lina',
			image: '/bilder/blog/sommerlager/1/web',
			tags: ['Lager', 'Sommer']
		});
		expect(p).toMatchObject({
			'@type': 'BlogPosting',
			headline: 'Sommerlager',
			datePublished: '2026-08-01T10:00:00.000Z',
			dateModified: '2026-08-01T10:00:00.000Z',
			author: { '@type': 'Person', name: 'Lina' },
			keywords: 'Lager, Sommer',
			image: [`${BASE}/bilder/blog/sommerlager/1/web`]
		});
		expect(
			blogPosting({ base: BASE, path: '/blog/x', title: 'X', publishedAt: '2026-01-01' }).author
		).toMatchObject({
			'@type': 'Organization'
		});
	});

	it('Hilfen: absolute Adressen, Klartext', () => {
		expect(absoluteUrl(`${BASE}/`, 'faq')).toBe(`${BASE}/faq`);
		expect(absoluteUrl(BASE, 'https://example.org/a')).toBe('https://example.org/a');
		expect(plainText('<p>a</p><p>b&nbsp;c</p>')).toBe('a b c');
		expect(plainText('x'.repeat(20), 10)).toHaveLength(11);
	});
});

describe('robots.txt / sitemap.xml / llms.txt', () => {
	it('robots.txt sperrt Aufgabe und Falle, erlaubt KI-Crawler, nennt die Sitemap', () => {
		const txt = robotsTxt(BASE);
		expect(txt).toContain(
			'User-agent: *\nAllow: /\nDisallow: /kontakt/challenge\nDisallow: /pfad-ins-unterholz'
		);
		for (const bot of AI_CRAWLERS) expect(txt).toContain(`User-agent: ${bot}\nAllow: /`);
		expect(txt).toContain(`Sitemap: ${BASE}/sitemap.xml`);
		expect(BOT_TRAP_PATH).toBe('/pfad-ins-unterholz');
	});

	it('sitemap.xml maskiert Adressen und entfernt Doppelte', () => {
		const xml = sitemapXml(BASE, [
			{ path: '/', priority: 1 },
			{ path: '/blog/a&b', lastmod: '2026-08-01T10:00:00Z' },
			{ path: '/', priority: 0.5 },
			{ path: '/galerie/x', lastmod: 'kaputt' }
		]);
		expect(xml.match(/<url>/g)).toHaveLength(3);
		expect(xml).toContain(`<loc>${BASE}/blog/a&amp;b</loc>`);
		expect(xml).toContain('<lastmod>2026-08-01T10:00:00.000Z</lastmod>');
		expect(xml).toContain('<priority>1.0</priority>');
		expect(xml).not.toContain('kaputt');
	});

	it('llms.txt mit Gruppen, Treffpunkt und Terminen; ohne Backend Hinweis', () => {
		const text = llmsTxt(BASE, {
			groups: [
				{
					name: 'Funkelfüchse',
					typeLabel: 'Meute',
					href: '/meute/funkelfuechse',
					ageRange: '7 bis 10 Jahre',
					weekday: 'Freitags',
					time: '16:30–18:00 Uhr',
					teaser: 'Wir spielen draußen.'
				}
			],
			events: [
				{ key: 'e1', title: 'Herbstfahrt [2026]', when: 'Fr, 30. Okt. 2026', location: null }
			]
		});
		expect(text.startsWith('# Stamm Edelweißpiraten\n')).toBe(true);
		expect(text).toContain(
			'Ev. Kirchengemeinde Bremen-Hastedt, Drakenburger Str. 42, 28207 Bremen'
		);
		expect(text).not.toContain('Auferstehung');
		expect(text).toContain(
			`- [Meute Funkelfüchse](${BASE}/meute/funkelfuechse): Alter 7 bis 10 Jahre, Gruppenstunde Freitags 16:30–18:00 Uhr. Wir spielen draußen.`
		);
		expect(text).toContain(`- [Herbstfahrt 2026](${BASE}/termine/e1): Fr, 30. Okt. 2026`);
		const offline = llmsTxt(BASE, { groups: [], events: null });
		expect(offline).not.toContain('## Gruppen');
		expect(offline).toContain('Gerade nicht abrufbar');
	});
});

describe('Gzip dynamischer Antworten', () => {
	const big = '<p>' + 'Pfadfinden in Bremen-Hastedt. '.repeat(100) + '</p>';
	const req = (enc: string | null, method = 'GET') =>
		new Request('http://localhost/', { method, headers: enc ? { 'accept-encoding': enc } : {} });
	const html = (body: BodyInit | null = big, init: ResponseInit = {}) =>
		new Response(body, {
			status: 200,
			...init,
			headers: { 'content-type': 'text/html; charset=utf-8', ...init.headers }
		});

	it('accept-encoding', () => {
		expect(acceptsGzip('gzip, deflate, br')).toBe(true);
		expect(acceptsGzip('br;q=1, gzip;q=0.5')).toBe(true);
		expect(acceptsGzip('gzip;q=0')).toBe(false);
		expect(acceptsGzip('br')).toBe(false);
		expect(acceptsGzip(null)).toBe(false);
	});

	it('komprimiert HTML mit gzip, setzt content-encoding/vary und entfernt content-length', async () => {
		const res = compressResponse(
			req('gzip, br'),
			html(big, {
				headers: { 'content-length': String(big.length), vary: 'cookie', etag: '"abc"' }
			})
		);
		expect(res.headers.get('content-encoding')).toBe('gzip');
		expect(res.headers.get('content-length')).toBeNull();
		expect(res.headers.get('vary')).toBe('cookie, accept-encoding');
		expect(res.headers.get('etag')).toBe('W/"abc"');
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.length).toBeLessThan(big.length);
		expect(gunzipSync(bytes).toString('utf8')).toBe(big);
	});

	it('lässt aus: ohne gzip, HEAD, 204/304, schon kodiert, Bilder, kleine Antworten, no-transform', () => {
		expect(shouldCompress(req(null), html())).toBe(false);
		expect(shouldCompress(req('gzip', 'HEAD'), html())).toBe(false);
		expect(shouldCompress(req('gzip'), new Response(null, { status: 204 }))).toBe(false);
		expect(shouldCompress(req('gzip'), new Response(null, { status: 304 }))).toBe(false);
		expect(shouldCompress(req('gzip'), html(big, { headers: { 'content-encoding': 'br' } }))).toBe(
			false
		);
		expect(
			shouldCompress(req('gzip'), new Response(big, { headers: { 'content-type': 'image/avif' } }))
		).toBe(false);
		expect(shouldCompress(req('gzip'), html('kurz', { headers: { 'content-length': '4' } }))).toBe(
			false
		);
		expect(
			shouldCompress(req('gzip'), html(big, { headers: { 'cache-control': 'no-transform' } }))
		).toBe(false);
		expect(
			shouldCompress(
				req('gzip'),
				new Response(big, { headers: { 'content-type': 'application/xml' } })
			)
		).toBe(true);
		expect(
			shouldCompress(
				req('gzip'),
				new Response(big, { headers: { 'content-type': 'application/json' } })
			)
		).toBe(true);
	});
});
