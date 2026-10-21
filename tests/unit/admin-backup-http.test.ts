/**
 * #63: Route-Guards der Datensicherung (`/admin/backup/**`). JSON-/Binär-Requests fallen nicht unter
 * den Origin-Check von SvelteKit – `http.server.ts` `guard` prüft Anmeldung, Recht, Herkunft und
 * Content-Type selbst. Geprüft wird der Helfer und, dass jeder Endpunkt ihn mit den richtigen
 * Optionen aufruft (abgewiesene Requests erreichen keinen Dienst, daher ohne Datenbank).
 */
import { describe, expect, it } from 'vitest';
import { guard } from '../../src/routes/(internal)/admin/backup/http.server';
import * as exportRoute from '../../src/routes/(internal)/admin/backup/export/+server';
import * as downloadRoute from '../../src/routes/(internal)/admin/backup/export/[id]/+server';
import * as analyzeRoute from '../../src/routes/(internal)/admin/backup/import/analyze/+server';
import * as executeRoute from '../../src/routes/(internal)/admin/backup/import/execute/+server';
import * as statusRoute from '../../src/routes/(internal)/admin/backup/import/status/[id]/+server';
import * as uploadRoute from '../../src/routes/(internal)/admin/backup/import/upload/+server';
import * as chunkRoute from '../../src/routes/(internal)/admin/backup/import/upload/[id]/+server';

const ORIGIN = 'http://intern.test';
const ID = 'abcdefghijklmnop';

const locals = (perms: string[] = ['core.system.backup'], user = true) =>
	({
		user: user ? { id: 'u1' } : null,
		ctx: { userId: user ? 'u1' : null, permissions: new Set(perms) }
	}) as unknown as App.Locals;

function req(path: string, method: string, headers: Record<string, string> = {}) {
	const url = new URL(ORIGIN + path);
	const body = method === 'GET' ? undefined : '{}';
	return { url, request: new Request(url, { method, headers, body }) };
}

async function status(res: Response | null) {
	if (!res) return null;
	const body = (await res.json()) as { message: string };
	return { status: res.status, message: body.message, cache: res.headers.get('cache-control') };
}

describe('guard (http.server.ts)', () => {
	const json = { origin: ORIGIN, 'content-type': 'application/json' };
	const write = { write: true, contentType: 'application/json' };

	it('ohne Anmeldung 401, ohne Recht 403', async () => {
		const { request, url } = req('/admin/backup/export', 'POST', json);
		expect(await status(guard(request, locals([], false), url, write))).toMatchObject({
			status: 401
		});
		expect(await status(guard(request, locals(['core.system.reset']), url, write))).toEqual({
			status: 403,
			message: 'Keine Berechtigung',
			cache: 'no-store'
		});
	});

	it('schreibend: fehlender oder fremder Origin → 403', async () => {
		const missing = req('/admin/backup/export', 'POST', { 'content-type': 'application/json' });
		expect(await status(guard(missing.request, locals(), missing.url, write))).toMatchObject({
			status: 403,
			message: 'Ungültige Herkunft der Anfrage'
		});
		const foreign = req('/admin/backup/export', 'POST', {
			origin: 'https://evil.example',
			'content-type': 'application/json'
		});
		expect(await status(guard(foreign.request, locals(), foreign.url, write))).toMatchObject({
			status: 403
		});
		// Gleicher Host, anderes Schema/Port ist ebenfalls fremd
		const port = req('/admin/backup/export', 'POST', {
			origin: 'http://intern.test:8080',
			'content-type': 'application/json'
		});
		expect(await status(guard(port.request, locals(), port.url, write))).toMatchObject({
			status: 403
		});
	});

	it('falscher Content-Type → 415, passender (auch mit charset) → durchgelassen', async () => {
		const wrong = req('/admin/backup/export', 'POST', {
			origin: ORIGIN,
			'content-type': 'text/plain'
		});
		expect(await status(guard(wrong.request, locals(), wrong.url, write))).toMatchObject({
			status: 415,
			message: 'Erwartet application/json'
		});
		const missing = req('/admin/backup/export', 'POST', { origin: ORIGIN });
		// Ohne eigenen Content-Type setzt Request für den String-Body text/plain → ebenfalls 415
		expect((await status(guard(missing.request, locals(), missing.url, write)))?.status).toBe(415);
		const okReq = req('/admin/backup/export', 'POST', {
			origin: ORIGIN,
			'content-type': 'Application/JSON; charset=utf-8'
		});
		expect(guard(okReq.request, locals(), okReq.url, write)).toBeNull();
	});

	it('lesend: nur websiteübergreifende Aufrufe werden abgewiesen', async () => {
		const cross = req('/admin/backup/export/x', 'GET', { 'sec-fetch-site': 'cross-site' });
		expect(await status(guard(cross.request, locals(), cross.url))).toMatchObject({
			status: 403
		});
		for (const site of ['same-origin', 'same-site', 'none']) {
			const r = req('/admin/backup/export/x', 'GET', { 'sec-fetch-site': site });
			expect(guard(r.request, locals(), r.url), site).toBeNull();
		}
		const plain = req('/admin/backup/export/x', 'GET');
		expect(guard(plain.request, locals(), plain.url)).toBeNull();
	});
});

type Handler = (event: unknown) => Promise<Response>;

const routes: {
	name: string;
	handler: Handler;
	method: string;
	path: string;
	contentType?: string;
	params?: Record<string, string>;
}[] = [
	{
		name: 'POST export',
		handler: exportRoute.POST as unknown as Handler,
		method: 'POST',
		path: '/admin/backup/export',
		contentType: 'application/json'
	},
	{
		name: 'POST import/analyze',
		handler: analyzeRoute.POST as unknown as Handler,
		method: 'POST',
		path: '/admin/backup/import/analyze',
		contentType: 'application/json'
	},
	{
		name: 'POST import/execute',
		handler: executeRoute.POST as unknown as Handler,
		method: 'POST',
		path: '/admin/backup/import/execute',
		contentType: 'application/json'
	},
	{
		name: 'POST import/upload',
		handler: uploadRoute.POST as unknown as Handler,
		method: 'POST',
		path: '/admin/backup/import/upload',
		contentType: 'application/json'
	},
	{
		name: 'PUT import/upload/[id]',
		handler: chunkRoute.PUT as unknown as Handler,
		method: 'PUT',
		path: `/admin/backup/import/upload/${ID}?offset=0`,
		contentType: 'application/octet-stream',
		params: { id: ID }
	}
];

describe('schreibende Backup-Endpunkte', () => {
	for (const r of routes) {
		const call = (headers: Record<string, string>, perms?: string[], user = true) => {
			const { request, url } = req(r.path, r.method, headers);
			return r.handler({ request, url, locals: locals(perms, user), params: r.params ?? {} });
		};

		it(`${r.name}: Anmeldung, Recht, Origin und Content-Type`, async () => {
			const good = { origin: ORIGIN, 'content-type': r.contentType! };
			expect((await call(good, [], false)).status).toBe(401);
			expect((await call(good, ['core.system.reset'])).status).toBe(403);
			expect((await call({ 'content-type': r.contentType! })).status).toBe(403);
			expect(
				(await call({ origin: 'https://evil.example', 'content-type': r.contentType! })).status
			).toBe(403);
			const wrongType = r.contentType === 'application/json' ? 'text/plain' : 'application/json';
			expect((await call({ origin: ORIGIN, 'content-type': wrongType })).status).toBe(415);
		});
	}
});

describe('lesende Backup-Endpunkte', () => {
	const reads: [string, Handler, string][] = [
		['GET export/[id]', downloadRoute.GET as unknown as Handler, `/admin/backup/export/${ID}`],
		[
			'GET import/status/[id]',
			statusRoute.GET as unknown as Handler,
			`/admin/backup/import/status/${ID}`
		]
	];
	for (const [name, handler, path] of reads) {
		it(`${name}: Anmeldung, Recht und websiteübergreifender Aufruf`, async () => {
			const call = (headers: Record<string, string>, perms?: string[], user = true) => {
				const { request, url } = req(path, 'GET', headers);
				return handler({ request, url, locals: locals(perms, user), params: { id: ID } });
			};
			expect((await call({}, [], false)).status).toBe(401);
			expect((await call({}, ['core.users.view'])).status).toBe(403);
			expect((await call({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
		});
	}
});
