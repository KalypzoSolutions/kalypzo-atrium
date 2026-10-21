/**
 * #72 (06-15, 06-13) und #25: Router-Details – sichere Request-ID, 405 mit `Allow`, HEAD, statische
 * Segmente vor `:param`, gestreamtes Body-Limit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { useTestDatabase } from '../helpers/db';
import { handleApiRequest } from '$lib/server/core/api/router';
import { registerCoreEndpoints, resetCoreEndpointsForTests } from '$lib/server/core/api/registry';
import { resetAllForTests } from '$lib/server/core/rate-limit';

let close: () => Promise<void>;
const ROOT = 'http://localhost:5173/api/v1';

async function call(method: string, path: string, init: RequestInit & { duplex?: string } = {}) {
	resetAllForTests();
	const url = new URL(`${ROOT}${path}`);
	return handleApiRequest({ request: new Request(url, { method, ...init }), url, ip: '127.0.0.1' });
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	resetCoreEndpointsForTests();
	registerCoreEndpoints([
		// absichtlich: Parameter-Route VOR der statischen registriert
		{
			method: 'GET',
			path: '/rt/:id',
			summary: 's',
			permission: null,
			handler: ({ params }) => ({ id: params.id })
		},
		{
			method: 'GET',
			path: '/rt/fixed',
			summary: 's',
			permission: null,
			handler: () => ({ fixed: true })
		},
		{ method: 'DELETE', path: '/rt/:id', summary: 's', permission: null, handler: () => null },
		{
			method: 'PUT',
			path: '/rt-body',
			summary: 's',
			permission: null,
			body: z.object({ text: z.string() }).strict(),
			handler: ({ body }) => ({ length: (body as { text: string }).text.length })
		},
		{
			method: 'PUT',
			path: '/rt-short',
			summary: 's',
			permission: null,
			body: z.object({ name: z.string().max(3), id: z.uuid() }).strict(),
			handler: () => null
		}
	]);
});

afterAll(async () => {
	resetCoreEndpointsForTests();
	await close();
});

describe('Router: x-request-id', () => {
	it('übernimmt gültige IDs', async () => {
		const res = await call('GET', '/rt/1', { headers: { 'x-request-id': 'proxy-1234-abcd' } });
		expect(res.headers.get('x-request-id')).toBe('proxy-1234-abcd');
	});

	it.each([
		['a'.repeat(65)],
		['kurz'],
		['mit leerzeichen 123'],
		['zeile\tfake-logeintrag'],
		['ü-umlaut-123']
	])('ersetzt ungültige ID %j durch eine UUID', async (bad) => {
		const res = await call('GET', '/rt/1', { headers: { 'x-request-id': bad } });
		expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
	});
});

describe('Router: Methoden', () => {
	it('405 mit Allow-Header', async () => {
		const res = await call('POST', '/rt/1');
		expect(res.status).toBe(405);
		const allow = (res.headers.get('allow') ?? '').split(', ').sort();
		expect(allow).toEqual(['DELETE', 'GET', 'HEAD']);
	});

	it('HEAD nutzt den GET-Endpunkt und liefert keinen Body', async () => {
		const res = await call('HEAD', '/rt/abc');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/json');
		expect(await res.text()).toBe('');
	});
});

describe('Router: Routenauflösung', () => {
	it('statisches Segment gewinnt unabhängig von der Registrierungsreihenfolge', async () => {
		const fixed = await call('GET', '/rt/fixed');
		expect((await fixed.json()).data).toEqual({ fixed: true });
		const param = await call('GET', '/rt/other');
		expect((await param.json()).data).toEqual({ id: 'other' });
	});
});

describe('Router: Body-Limit gestreamt (#25)', () => {
	const big = JSON.stringify({ text: 'x'.repeat(8_000_000) });

	it('413 ohne Content-Length (chunked), bevor alles gelesen ist', async () => {
		const bytes = new TextEncoder().encode(big);
		let pulled = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (pulled >= bytes.length) return controller.close();
				controller.enqueue(bytes.slice(pulled, pulled + 64 * 1024));
				pulled += 64 * 1024;
			}
		});
		const res = await call('PUT', '/rt-body', {
			headers: { 'content-type': 'application/json' },
			body: stream,
			duplex: 'half'
		});
		expect(res.status).toBe(413);
		expect(pulled).toBeLessThan(bytes.length);
	});

	it('413 bei zu großem Content-Length', async () => {
		const res = await call('PUT', '/rt-body', {
			headers: { 'content-type': 'application/json', 'content-length': '2000000' },
			body: '{}'
		});
		expect(res.status).toBe(413);
	});

	it('zählt Bytes statt Zeichen (Umlaute)', async () => {
		// 600 000 × „ü“ = 1,2 MB UTF-8, aber nur 600 000 Zeichen
		const res = await call('PUT', '/rt-body', {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'ü'.repeat(600_000) })
		});
		expect(res.status).toBe(413);
	});

	it('kleine Bodies funktionieren weiter', async () => {
		const res = await call('PUT', '/rt-body', {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text: 'Grüße' })
		});
		expect(res.status).toBe(200);
		expect((await res.json()).data).toEqual({ length: 5 });
	});
});

describe('Zod-Meldungen auf Deutsch (06-10)', () => {
	it('422-details enthalten deutsche Standardmeldungen', async () => {
		const res = await call('PUT', '/rt-short', {
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'viel zu lang', id: 'keine-uuid' })
		});
		expect(res.status).toBe(422);
		const body = await res.json();
		const messages = (body.error.details as { message: string }[]).map((d) => d.message);
		expect(messages).toHaveLength(2);
		for (const m of messages) {
			expect(m).not.toMatch(/too big|invalid|expected/i);
		}
		expect(messages.sort()).toEqual(['Höchstens 3 Zeichen', 'Ungültige ID']);
	});
});
