import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import { disableModule, enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { allEndpoints } from '$lib/server/core/api/registry';
import { handleApiRequest } from '$lib/server/core/api/router';
import { resetAllForTests as reset } from '$lib/server/core/rate-limit';
import { setMailTransportForTests } from '$lib/server/core/mail';
import { core } from '$lib/server/core';
import { defineModule } from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';

const BASE = '/modules/pubtest';
let admin: RequestContext;

const publicGet = {
	method: 'GET',
	path: '/hello',
	summary: 'Öffentlicher Gruß',
	permission: null,
	public: true,
	rateLimit: { limit: 3, windowSec: 60 },
	handler: () => ({ hello: 'welt' })
};

const publicPost = {
	method: 'POST',
	path: '/echo',
	summary: 'Öffentliches Echo',
	permission: null,
	public: true,
	rateLimit: { limit: 1000, windowSec: 60 },
	body: z.object({ text: z.string().max(50) }),
	handler: ({ body }: { body: { text: string } }) => ({ echo: body.text })
};

const publicUpload = {
	method: 'POST',
	path: '/upload',
	summary: 'Öffentlicher Upload',
	permission: null,
	public: true,
	rateLimit: { limit: 1000, windowSec: 60 },
	multipart: { maxBytes: 2048, maxFiles: 1 },
	body: z.object({ title: z.string().min(1).max(20) }).strict(),
	handler: ({ body, files }: { body: { title: string }; files?: File[] }) => ({
		title: body.title,
		files: (files ?? []).map((f) => ({ name: f.name, size: f.size }))
	})
};

const mod = defineModule({
	manifest: {
		id: 'pubtest',
		name: 'Public Test',
		version: '1.0.0',
		dependencies: [],
		permissions: ['pubtest.thing.view'],
		navigation: []
	},
	endpoints: [publicGet, publicPost, publicUpload] as never
});

function call(
	path: string,
	init: { method?: string; json?: unknown; ip?: string; contentType?: string } = {}
) {
	const headers = new Headers();
	let body: string | undefined;
	if (init.json !== undefined) {
		body = typeof init.json === 'string' ? init.json : JSON.stringify(init.json);
		headers.set('content-type', init.contentType ?? 'application/json');
	}
	const url = new URL(`http://localhost:5173/api/v1${BASE}${path}`);
	return handleApiRequest({
		request: new Request(url, { method: init.method ?? 'GET', headers, body }),
		url,
		ip: init.ip ?? '10.0.0.1'
	});
}

/** multipart-Request mit gesetzter Content-Length (wie ein Browser). */
async function upload(
	fields: Record<string, string>,
	files: { name: string; bytes: Uint8Array }[] = [],
	opts: { contentType?: string; noLength?: boolean; lengthOverride?: string } = {}
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	for (const f of files) fd.append('file', new File([f.bytes as BlobPart], f.name));
	const encoded = new Response(fd);
	const body = new Uint8Array(await encoded.arrayBuffer());
	const headers = new Headers({
		'content-type': opts.contentType ?? encoded.headers.get('content-type')!
	});
	if (!opts.noLength) headers.set('content-length', opts.lengthOverride ?? String(body.byteLength));
	const url = new URL(`http://localhost:5173/api/v1${BASE}/upload`);
	return handleApiRequest({
		request: new Request(url, { method: 'POST', headers, body }),
		url,
		ip: '10.0.0.9'
	});
}

beforeAll(async () => {
	await useTestDatabase();
	registerCoreApi();
	registerModule(mod);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	const r = await contextForUser(u!.id);
	admin = r!.ctx;
	await enableModule(admin, 'pubtest');
	admin = (await contextForUser(u!.id))!.ctx;
});

afterAll(() => setMailTransportForTests(undefined));

describe('öffentliche Modul-Endpoints', () => {
	it('sind anonym erreichbar (GET und POST) und nicht cachebar', async () => {
		reset();
		const g = await call('/hello');
		expect(g.status).toBe(200);
		expect(g.headers.get('cache-control')).toBe('no-store');
		expect((await g.json()).data).toEqual({ hello: 'welt' });
		const p = await call('/echo', { method: 'POST', json: { text: 'hi' } });
		expect(p.status).toBe(201);
		expect((await p.json()).data).toEqual({ echo: 'hi' });
	});

	it('mutierende Aufrufe ohne JSON-Content-Type werden abgelehnt', async () => {
		reset();
		const res = await call('/echo', {
			method: 'POST',
			json: { text: 'x' },
			contentType: 'text/plain'
		});
		expect(res.status).toBe(400);
		const form = await call('/echo', {
			method: 'POST',
			json: 'text=x',
			contentType: 'application/x-www-form-urlencoded'
		});
		expect(form.status).toBe(400);
	});

	it('Rate-Limit je IP greift (429)', async () => {
		reset();
		for (let i = 0; i < 3; i++) expect((await call('/hello')).status).toBe(200);
		const blocked = await call('/hello');
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get('retry-after')).toBeTruthy();
		expect((await call('/hello', { ip: '10.0.0.2' })).status).toBe(200);
	});

	it('Gesamt-Bucket greift unabhängig von der IP', async () => {
		reset();
		// limit 3 * 20 = 60, Minimum 200: 200 Anfragen von je anderer IP sind erlaubt
		for (let i = 0; i < 200; i++) {
			const res = await call('/hello', { ip: `192.168.${Math.floor(i / 250)}.${i % 250}` });
			expect(res.status).toBe(200);
		}
		expect((await call('/hello', { ip: '172.16.0.1' })).status).toBe(429);
	});

	it('deaktiviertes Modul ist nicht erreichbar (404)', async () => {
		reset();
		await disableModule(admin, 'pubtest');
		try {
			expect((await call('/hello')).status).toBe(404);
		} finally {
			await enableModule(admin, 'pubtest');
		}
	});
});

describe('öffentliche multipart-Endpoints', () => {
	it('nimmt Textfelder (validiert) und Dateien an', async () => {
		reset();
		const res = await upload({ title: 'Beleg' }, [{ name: 'a.pdf', bytes: new Uint8Array(10) }]);
		expect(res.status).toBe(201);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect((await res.json()).data).toEqual({
			title: 'Beleg',
			files: [{ name: 'a.pdf', size: 10 }]
		});
	});

	it('verlangt multipart/form-data (JSON und andere Typen → 400)', async () => {
		reset();
		const json = await call('/upload', { method: 'POST', json: { title: 'x' } });
		expect(json.status).toBe(400);
		const wrong = await upload({ title: 'x' }, [], { contentType: 'text/plain' });
		expect(wrong.status).toBe(400);
	});

	it('verlangt Content-Length und begrenzt die Größe (413)', async () => {
		reset();
		expect((await upload({ title: 'x' }, [], { noLength: true })).status).toBe(400);
		const big = await upload({ title: 'x' }, [{ name: 'b.bin', bytes: new Uint8Array(4096) }]);
		expect(big.status).toBe(413);
		expect((await big.json()).error.code).toBe('payload_too_large');
		// gelogene Content-Length: tatsächliche Größe zählt
		const lied = await upload({ title: 'x' }, [{ name: 'b.bin', bytes: new Uint8Array(4096) }], {
			lengthOverride: '100'
		});
		expect([400, 413]).toContain(lied.status);
	});

	it('validiert die Textfelder (422) und begrenzt die Dateianzahl', async () => {
		reset();
		const bad = await upload({ title: '' });
		expect(bad.status).toBe(422);
		expect((await bad.json()).error.code).toBe('validation_failed');
		const unknown = await upload({ title: 'x', extra: '1' });
		expect(unknown.status).toBe(422);
		const many = await upload({ title: 'x' }, [
			{ name: 'a', bytes: new Uint8Array(1) },
			{ name: 'b', bytes: new Uint8Array(1) }
		]);
		expect(many.status).toBe(400);
	});
});

describe('Registrierung: Opt-in-Pflichten', () => {
	const registryWith = (e: Record<string, unknown>) => {
		unregisterModule('pubbad');
		registerModule(
			defineModule({
				manifest: {
					id: 'pubbad',
					name: 'Bad',
					version: '1.0.0',
					dependencies: [],
					permissions: ['pubbad.x.view'],
					navigation: []
				},
				endpoints: [{ method: 'GET', path: '/x', summary: 's', handler: () => 1, ...e }] as never
			})
		);
	};

	it('verwirft unvollständige oder widersprüchliche Opt-ins', () => {
		const rl = { limit: 5, windowSec: 60 };
		const cases: Record<string, unknown>[] = [
			{ permission: null },
			{ permission: null, public: true },
			{ permission: null, public: true, rateLimit: rl, method: 'POST' },
			{ permission: null, public: true, rateLimit: rl, method: 'DELETE' },
			{ permission: 'pubbad.x.view', public: true, rateLimit: rl }
		];
		for (const c of cases) {
			registryWith(c);
			expect(() => allEndpoints(), JSON.stringify(c)).toThrow();
		}
		registryWith({ permission: null, public: true, rateLimit: rl });
		expect(() => allEndpoints()).not.toThrow();
		unregisterModule('pubbad');
	});

	it('erlaubt multipart nur für öffentliche POSTs mit body und begrenzter Größe', () => {
		const rl = { limit: 5, windowSec: 60 };
		const body = z.object({ a: z.string() });
		const mp = { maxBytes: 1024 };
		const cases: Record<string, unknown>[] = [
			{ permission: 'pubbad.x.view', method: 'POST', body, multipart: mp },
			{ permission: null, public: true, rateLimit: rl, method: 'GET', multipart: mp },
			{ permission: null, public: true, rateLimit: rl, method: 'POST', multipart: mp },
			{
				permission: null,
				public: true,
				rateLimit: rl,
				method: 'POST',
				body,
				multipart: { maxBytes: 31 * 1024 * 1024 }
			}
		];
		for (const c of cases) {
			registryWith(c);
			expect(() => allEndpoints(), JSON.stringify(c)).toThrow();
		}
		registryWith({
			permission: null,
			public: true,
			rateLimit: rl,
			method: 'POST',
			body,
			multipart: mp
		});
		expect(() => allEndpoints()).not.toThrow();
		unregisterModule('pubbad');
	});
});

describe('core.mail.send', () => {
	it('sendet über den Transport und validiert Eingaben', async () => {
		const sent: { to: string; subject: string }[] = [];
		setMailTransportForTests({
			sendMail: async (m) => {
				sent.push({ to: m.to, subject: m.subject });
			}
		});
		await core.mail.send({ to: 'a@example.test', subject: 'Hallo', text: 'Text' });
		expect(sent).toEqual([{ to: 'a@example.test', subject: 'Hallo' }]);

		const bad = [
			{ to: 'a@example.test, b@example.test', subject: 'x', text: 't' },
			{ to: 'a@example.test\nBcc: b@example.test', subject: 'x', text: 't' },
			{ to: 'keine-mail', subject: 'x', text: 't' },
			{ to: 'a@example.test', subject: 'x\r\nBcc: evil@example.test', text: 't' },
			{ to: 'a@example.test', subject: 'x'.repeat(201), text: 't' },
			{ to: 'a@example.test', subject: 'x', text: 't'.repeat(20001) }
		];
		for (const m of bad) await expect(core.mail.send(m)).rejects.toThrow();
		expect(sent).toHaveLength(1);
	});
});
