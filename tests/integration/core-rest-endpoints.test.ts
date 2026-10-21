/**
 * #63: Core-REST-Endpunkte, die bisher nur über die Dienste dahinter getestet waren – je Endpunkt
 * Erfolg und fehlendes Recht über `handleApiRequest`: PATCH/DELETE `/users/:id`, PATCH/DELETE
 * `/roles/:id`, DELETE `/api-keys/:id` (nur Session), `/jobs`, `/jobs/:key/run`, `/pdf`, `/ai/*`,
 * `/audit-logs`. Die Storage-Endpunkte deckt `storage-api-guard.test.ts` ab.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getAuth } from '$lib/server/core/auth';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { getDb, schema } from '$lib/server/core/database/client';
import { setPdfRendererForTests } from '$lib/server/core/pdf';
import { setOpenAiClientFactoryForTests } from '$lib/server/core/ai';
import { setSettings } from '$lib/server/core/settings/service';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import type { RequestContext } from '$lib/sdk/types';

const ORIGIN = 'http://localhost:5173';
const PW = 'correct-horse-battery';
let close: () => Promise<void>;
let admin: RequestContext;
const keys: Record<string, string> = {};
const cookies: Record<string, string> = {};
const ids: Record<string, string> = {};

interface Res {
	status: number;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	body: any;
	headers: Headers;
}

async function call(
	who: string,
	method: string,
	path: string,
	json?: unknown,
	via: 'key' | 'session' = 'key'
): Promise<Res> {
	resetAllForTests();
	const headers = new Headers();
	if (via === 'key') headers.set('authorization', `Bearer ${keys[who]}`);
	else {
		headers.set('cookie', cookies[who]!);
		headers.set('origin', ORIGIN);
	}
	if (json !== undefined) headers.set('content-type', 'application/json');
	const url = new URL(`${ORIGIN}/api/v1${path}`);
	const res = await handleApiRequest({
		request: new Request(url, {
			method,
			headers,
			body: json === undefined ? undefined : JSON.stringify(json)
		}),
		url,
		ip: '127.0.0.1'
	});
	const type = res.headers.get('content-type') ?? '';
	const body = type.includes('json') ? await res.json() : await res.arrayBuffer();
	return { status: res.status, body, headers: res.headers };
}

const forbidden = (r: Res) => {
	expect(r.status, JSON.stringify(r.body)).toBe(403);
	expect(r.body.error.code).toBe('forbidden');
};
const ok = (r: Res, status = 200) => {
	expect(r.status, r.body instanceof ArrayBuffer ? '' : JSON.stringify(r.body)).toBe(status);
	return r.body.data;
};

async function signIn(email: string): Promise<string> {
	const res = await getAuth().api.signInEmail({
		body: { email, password: PW },
		returnHeaders: true
	});
	return res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	ids.admin = u!.id;
	admin = (await contextForUser(u!.id))!.ctx;
	// „Leser“: darf Benutzer/Rollen sehen und eigene API-Keys anlegen, sonst nichts
	const readerRole = await createRole(admin, {
		name: 'Leser',
		permissions: ['core.api.manage', 'core.users.view', 'core.roles.view']
	});
	ids.reader = await createUser(admin, {
		name: 'Lea Leser',
		email: 'reader@example.test',
		password: PW,
		roleIds: [readerRole]
	});
	const plainRole = await createRole(admin, { name: 'Ohne API', permissions: ['core.users.view'] });
	ids.plain = await createUser(admin, {
		name: 'Paul Plain',
		email: 'plain@example.test',
		password: PW,
		roleIds: [plainRole]
	});
	keys.admin = (
		await createApiKey(admin, {
			name: 'admin',
			scopes: [...admin.permissions].filter((p) => p.startsWith('core.'))
		})
	).key;
	const reader = (await contextForUser(ids.reader))!.ctx;
	keys.reader = (
		await createApiKey(reader, { name: 'reader', scopes: [...reader.permissions] })
	).key;
	cookies.admin = await signIn('admin@example.test');
	cookies.plain = await signIn('plain@example.test');
	setPdfRendererForTests(async () => new TextEncoder().encode('%PDF-1.4 test'));
});

afterAll(async () => {
	setPdfRendererForTests(undefined);
	setOpenAiClientFactoryForTests(undefined);
	await close();
});

describe('Benutzer', () => {
	it('PATCH /users/:id: Erfolg mit core.users.edit, sonst 403', async () => {
		forbidden(await call('reader', 'PATCH', `/users/${ids.plain}`, { name: 'Gehackt' }));
		const user = ok(await call('admin', 'PATCH', `/users/${ids.plain}`, { name: 'Paula Plain' }));
		expect(user).toMatchObject({ id: ids.plain, name: 'Paula Plain' });
		// Validierung
		expect(
			(await call('admin', 'PATCH', `/users/${ids.plain}`, { email: 'keine-mail' })).status
		).toBe(422);
	});

	it('DELETE /users/:id: Erfolg mit core.users.delete, sonst 403', async () => {
		const victim = await createUser(admin, {
			name: 'Weg Damit',
			email: 'weg@example.test',
			password: PW,
			roleIds: []
		});
		forbidden(await call('reader', 'DELETE', `/users/${victim}`));
		expect(ok(await call('admin', 'DELETE', `/users/${victim}`))).toBeNull();
		expect((await call('admin', 'GET', `/users/${victim}`)).status).toBe(404);
	});
});

describe('Rollen', () => {
	it('PATCH /roles/:id: Erfolg mit core.roles.edit, sonst 403', async () => {
		const role = await createRole(admin, { name: 'Testrolle', permissions: [] });
		forbidden(await call('reader', 'PATCH', `/roles/${role}`, { name: 'Umbenannt' }));
		expect(
			ok(await call('admin', 'PATCH', `/roles/${role}`, { permissions: ['core.users.view'] }))
		).toBeNull();
		const roles = ok(await call('reader', 'GET', '/roles')) as {
			id: string;
			permissions: string[];
		}[];
		expect(roles.find((r) => r.id === role)?.permissions).toEqual(['core.users.view']);
	});

	it('DELETE /roles/:id: Erfolg mit core.roles.delete, sonst 403', async () => {
		const role = await createRole(admin, { name: 'Wegrolle', permissions: [] });
		forbidden(await call('reader', 'DELETE', `/roles/${role}`));
		expect(ok(await call('admin', 'DELETE', `/roles/${role}`))).toBeNull();
		const roles = ok(await call('reader', 'GET', '/roles')) as { id: string }[];
		expect(roles.some((r) => r.id === role)).toBe(false);
	});
});

describe('API-Keys', () => {
	it('DELETE /api-keys/:id nur per Session und mit core.api.manage', async () => {
		const { item } = await createApiKey(admin, { name: 'wegwerf', scopes: ['core.users.view'] });
		// Per API-Key nie (auch nicht als Administrator*in)
		forbidden(await call('admin', 'DELETE', `/api-keys/${item.id}`));
		// Session ohne core.api.manage
		forbidden(await call('plain', 'DELETE', `/api-keys/${item.id}`, undefined, 'session'));
		expect(
			ok(await call('admin', 'DELETE', `/api-keys/${item.id}`, undefined, 'session'))
		).toBeNull();
		const list = ok(await call('admin', 'GET', '/api-keys', undefined, 'session')) as {
			id: string;
			revokedAt: string | null;
		}[];
		expect(list.find((k) => k.id === item.id)?.revokedAt).not.toBeNull();
	});
});

describe('Hintergrundjobs', () => {
	it('GET /jobs und POST /jobs/:key/run mit core.jobs.manage, sonst 403', async () => {
		forbidden(await call('reader', 'GET', '/jobs'));
		forbidden(await call('reader', 'POST', '/jobs/core.housekeeping/run'));
		const jobs = ok(await call('admin', 'GET', '/jobs')) as { key: string }[];
		expect(jobs.map((j) => j.key)).toContain('core.housekeeping');
		const run = ok(await call('admin', 'POST', '/jobs/core.housekeeping/run'), 201);
		expect(run).toMatchObject({ key: 'core.housekeeping', lastStatus: 'ok' });
		expect((await call('admin', 'POST', '/jobs/core.unbekannt/run')).body.error.code).toBe(
			'not_found'
		);
	});
});

describe('PDF', () => {
	it('POST /pdf liefert ein PDF mit core.pdf.generate, sonst 403', async () => {
		const body = { title: 'Test', content: [{ type: 'paragraph', text: 'Hallo' }] };
		forbidden(await call('reader', 'POST', '/pdf', body));
		const r = await call('admin', 'POST', '/pdf', body);
		expect(r.status).toBe(200);
		expect(r.headers.get('content-type')).toBe('application/pdf');
		expect(r.headers.get('cache-control')).toBe('no-store');
		expect(new TextDecoder().decode(r.body as ArrayBuffer)).toContain('%PDF');
		expect((await call('admin', 'POST', '/pdf', { title: '' })).status).toBe(422);
	});
});

describe('KI', () => {
	it('POST /ai/generate: ohne Konfiguration 503, konfiguriert Erfolg, ohne Recht 403', async () => {
		forbidden(await call('reader', 'POST', '/ai/generate', { prompt: 'Hallo' }));
		const unconfigured = await call('admin', 'POST', '/ai/generate', { prompt: 'Hallo' });
		expect(unconfigured.status).toBe(503);
		await setSettings(admin, { 'core.ai.apiKey': 'sk-test', 'core.ai.defaultModel': 'gpt-test' });
		setOpenAiClientFactoryForTests(() => ({
			complete: async () => ({ text: 'Antwort', inputTokens: 3, outputTokens: 2 }),
			// eslint-disable-next-line require-yield
			stream: async function* () {
				return;
			}
		}));
		const res = ok(await call('admin', 'POST', '/ai/generate', { prompt: 'Hallo' }), 201);
		expect(res).toMatchObject({ text: 'Antwort' });
	});

	it('GET /ai/usage mit core.ai.view, sonst 403', async () => {
		forbidden(await call('reader', 'GET', '/ai/usage'));
		const rows = ok(await call('admin', 'GET', '/ai/usage')) as { moduleId: string }[];
		expect(rows.some((r) => r.moduleId === 'core')).toBe(true);
	});
});

describe('Audit', () => {
	it('GET /audit-logs mit core.audit.view (Filter nach Aktion), sonst 403', async () => {
		forbidden(await call('reader', 'GET', '/audit-logs'));
		const page = ok(await call('admin', 'GET', '/audit-logs?action=core.role&limit=50')) as {
			rows: { action: string }[];
			total: number;
		};
		expect(page.rows.length).toBeGreaterThan(0);
		expect(page.total).toBe(page.rows.length);
		expect(page.rows.every((i) => i.action.startsWith('core.role'))).toBe(true);
	});
});
