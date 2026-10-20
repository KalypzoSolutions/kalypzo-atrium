import { describe, expect, it } from 'vitest';
import {
	buildConsoleRequest,
	buildCurl,
	isMutating,
	MAX_RESULT_CHARS,
	pathParamNames,
	readConsoleResult
} from '$lib/api-docs/console';
import type { ConsoleRequestInput } from '$lib/api-docs/types';

function input(over: Partial<ConsoleRequestInput> = {}): ConsoleRequestInput {
	return { method: 'GET', path: '/api/v1/users', params: {}, query: {}, bodyText: '', ...over };
}

describe('pathParamNames', () => {
	it('liefert Namen in Reihenfolge ohne Duplikate', () => {
		expect(pathParamNames('/api/v1/actions/:id/entries/:entryId')).toEqual(['id', 'entryId']);
		expect(pathParamNames('/api/v1/a/:id/b/:id')).toEqual(['id']);
		expect(pathParamNames('/api/v1/users')).toEqual([]);
	});
});

describe('isMutating', () => {
	it('GET ist nicht ändernd, alles andere schon', () => {
		expect(isMutating('GET')).toBe(false);
		expect(isMutating('get')).toBe(false);
		for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isMutating(m)).toBe(true);
	});
});

describe('buildConsoleRequest', () => {
	it('baut einfache GET-Anfrage ohne Body und ohne Authorization', () => {
		const r = buildConsoleRequest(input());
		expect(r).toEqual({
			ok: true,
			url: '/api/v1/users',
			init: { method: 'GET', headers: { accept: 'application/json' } }
		});
	});

	it('kodiert Sonderzeichen in Pfadparametern', () => {
		const r = buildConsoleRequest(
			input({ path: '/api/v1/users/:id/x/:idx', params: { id: 'a b/ä?#&', idx: '1' } })
		);
		expect(r.ok && r.url).toBe('/api/v1/users/a%20b%2F%C3%A4%3F%23%26/x/1');
	});

	it('verlangt jeden Pfadparameter', () => {
		const r = buildConsoleRequest(input({ path: '/api/v1/users/:id', params: { id: '  ' } }));
		expect(r).toEqual({ ok: false, error: 'Pfadparameter „id“ fehlt.', field: 'param:id' });
		const r2 = buildConsoleRequest(input({ path: '/api/v1/users/:id' }));
		expect(r2.ok).toBe(false);
	});

	it('lehnt . und .. als Parameter ab', () => {
		for (const id of ['.', '..']) {
			const r = buildConsoleRequest(input({ path: '/api/v1/users/:id', params: { id } }));
			expect(r.ok === false && r.field).toBe('param:id');
		}
	});

	it('lehnt unsichere Pfade ab', () => {
		for (const path of [
			'/api/v2/users',
			'/api/v1',
			'api/v1/users',
			'/api/v1/../login',
			'/api/v1//evil.test',
			'//evil.test/api/v1/',
			'https://evil.test/api/v1/users',
			'/api/v1/x/https://evil.test',
			'/api/v1/x\\y',
			'/api/v1/users?x=1'
		]) {
			const r = buildConsoleRequest(input({ path }));
			expect(r.ok, path).toBe(false);
		}
	});

	it('Query: leere Werte weglassen, kodieren', () => {
		const r = buildConsoleRequest(
			input({ query: { search: 'a&b c', empty: '', blank: '  ', limit: '10' } })
		);
		expect(r.ok && r.url).toBe('/api/v1/users?search=a%26b+c&limit=10');
		const r2 = buildConsoleRequest(input({ query: { a: '' } }));
		expect(r2.ok && r2.url).toBe('/api/v1/users');
	});

	it('POST mit JSON-Body: kompakt und mit content-type', () => {
		const r = buildConsoleRequest(
			input({ method: 'POST', bodyText: '{\n  "name": "Tessa",\n  "n": 1\n}' })
		);
		expect(r.ok && r.init).toEqual({
			method: 'POST',
			headers: { accept: 'application/json', 'content-type': 'application/json' },
			body: '{"name":"Tessa","n":1}'
		});
	});

	it('ungültiges JSON → deutsche Meldung, Feld body', () => {
		const r = buildConsoleRequest(input({ method: 'PUT', bodyText: '{ name: 1 }' }));
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.field).toBe('body');
			expect(r.error.startsWith('Body ist kein gültiges JSON: ')).toBe(true);
		}
	});

	it('DELETE ohne Body hat keinen Body und kein content-type', () => {
		const r = buildConsoleRequest(
			input({ method: 'DELETE', path: '/api/v1/users/:id', params: { id: 'u1' }, bodyText: ' ' })
		);
		expect(r.ok && r.init).toEqual({
			method: 'DELETE',
			headers: { accept: 'application/json' }
		});
	});

	it('DELETE mit Body wird gesendet', () => {
		const r = buildConsoleRequest(input({ method: 'DELETE', bodyText: '[1,2]' }));
		expect(r.ok && r.init.body).toBe('[1,2]');
	});

	it('GET ignoriert Body-Text (auch ungültigen)', () => {
		const r = buildConsoleRequest(input({ bodyText: 'kaputt' }));
		expect(r.ok && r.init.body).toBe(undefined);
	});
});

describe('buildCurl', () => {
	it('mehrzeilig mit Platzhalter und escaptem Body', () => {
		const c = buildCurl(
			input({ method: 'POST', bodyText: `{"name":"O'Brien"}` }),
			'https://intern.example.test/'
		);
		expect(c).toBe(
			[
				`curl -X POST 'https://intern.example.test/api/v1/users'`,
				`-H "Accept: application/json"`,
				`-H "Authorization: Bearer $EPK_KEY"`,
				`-H "Content-Type: application/json"`,
				`--data '{"name":"O'\\''Brien"}'`
			].join(' \\\n  ')
		);
		expect(c).not.toMatch(/cookie/i);
	});

	it('einzeilig ohne Body', () => {
		const c = buildCurl(input({ query: { q: "it's" } }), 'http://localhost:4300', {
			multiline: false
		});
		expect(c).toBe(
			`curl -X GET 'http://localhost:4300/api/v1/users?q=it%27s' -H "Accept: application/json" -H "Authorization: Bearer $EPK_KEY"`
		);
	});

	it('ungültige Eingabe → leerer String', () => {
		expect(buildCurl(input({ path: '/api/v1/users/:id' }), 'http://x')).toBe('');
		expect(buildCurl(input({ method: 'POST', bodyText: '{' }), 'http://x')).toBe('');
	});
});

describe('readConsoleResult', () => {
	it('JSON wird eingerückt, Header werden gelesen', async () => {
		const res = new Response('{"data":{"a":1}}', {
			status: 201,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'x-request-id': 'req-1',
				'x-ratelimit-remaining': '42'
			}
		});
		const r = await readConsoleResult(res, 1000, 1234.6);
		expect(r).toEqual({
			status: 201,
			durationMs: 235,
			requestId: 'req-1',
			rateLimitRemaining: '42',
			contentType: 'application/json; charset=utf-8',
			bodyText: '{\n  "data": {\n    "a": 1\n  }\n}'
		});
	});

	it('kaputtes JSON und Text werden roh angezeigt, fehlende Header null', async () => {
		const r = await readConsoleResult(
			new Response('{oops', { headers: { 'content-type': 'application/json' } }),
			0,
			0
		);
		expect(r.bodyText).toBe('{oops');
		expect(r.requestId).toBeNull();
		expect(r.rateLimitRemaining).toBeNull();
		const t = await readConsoleResult(
			new Response('a;b', { headers: { 'content-type': 'text/csv' } }),
			5,
			1
		);
		expect(t.bodyText).toBe('a;b');
		expect(t.durationMs).toBe(0);
	});

	it('leere Antwort (204)', async () => {
		const r = await readConsoleResult(new Response(null, { status: 204 }), 0, 3);
		expect(r.status).toBe(204);
		expect(r.bodyText).toBe('');
		expect(r.contentType).toBeNull();
	});

	it('kürzt lange Antworten', async () => {
		const long = 'x'.repeat(MAX_RESULT_CHARS + 10);
		const r = await readConsoleResult(
			new Response(long, { headers: { 'content-type': 'text/plain' } }),
			0,
			0
		);
		expect(r.bodyText).toBe(`${'x'.repeat(MAX_RESULT_CHARS)}\n… (gekürzt)`);
		const exact = await readConsoleResult(
			new Response('y'.repeat(MAX_RESULT_CHARS), { headers: { 'content-type': 'text/plain' } }),
			0,
			0
		);
		expect(exact.bodyText.length).toBe(MAX_RESULT_CHARS);
	});

	it('binäre Antwort (PDF)', async () => {
		const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1, 2]);
		const r = await readConsoleResult(
			new Response(bytes, { headers: { 'content-type': 'application/pdf' } }),
			0,
			0
		);
		expect(r.bodyText).toBe('Binäre Antwort (application/pdf, 7 Bytes)');
		expect(r.contentType).toBe('application/pdf');
	});
});
