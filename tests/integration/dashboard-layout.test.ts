/**
 * Dashboard: gespeicherte Anordnung (`core.user.dashboard`) über Service und `+server.ts`-Handler,
 * Core-Kennzahlen nach Rechten.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { syncModules } from '$lib/server/core/modules/service';
import { getSetting, setSetting } from '$lib/server/core/settings/service';
import { isCoreError } from '$lib/server/core/errors';
import { PUT as putLayout } from '../../src/routes/(internal)/dashboard/layout/+server';
import { GET as getCore } from '../../src/routes/(internal)/dashboard/core/+server';
import { load as loadPage } from '../../src/routes/(internal)/dashboard/+page.server';
import type { RequestContext } from '$lib/sdk/types';

const ORIGIN = 'http://localhost:5173';
const KEY = 'core.user.dashboard';
let close: () => Promise<void>;
let adminId: string;
let userId: string;
let admin: RequestContext;
let user: RequestContext;

const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;

beforeAll(async () => {
	({ close } = await useTestDatabase());
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [a] = await getDb()
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = a!.id;
	admin = await ctxOf(adminId);
	const role = await createRole(admin, { name: 'Leer', permissions: [] });
	userId = await createUser(admin, {
		name: 'Nora Nutzer',
		email: 'nora@example.test',
		password: 'correct-horse-battery',
		roleIds: [role]
	});
	user = await ctxOf(userId);
});

afterAll(async () => {
	await close();
});

async function codeOf(p: Promise<unknown>): Promise<number> {
	try {
		await p;
		return 0;
	} catch (e) {
		if (isCoreError(e)) return e.status;
		throw e;
	}
}

function call(
	handler: (e: never) => Promise<Response> | Response,
	init: { ctx?: RequestContext; method?: string; body?: unknown; origin?: string | null } = {}
) {
	const headers = new Headers();
	if (init.origin !== null) headers.set('origin', init.origin ?? ORIGIN);
	if (init.body !== undefined) headers.set('content-type', 'application/json');
	const url = new URL(`${ORIGIN}/dashboard/x`);
	const request = new Request(url, {
		method: init.method ?? 'GET',
		headers,
		body: init.body === undefined ? undefined : JSON.stringify(init.body)
	});
	const locals = init.ctx
		? { ctx: init.ctx, user: { id: init.ctx.userId } }
		: { ctx: { permissions: new Set<string>() }, user: null };
	return (handler as (e: unknown) => Promise<Response>)({ request, url, locals });
}

describe('Service setSetting', () => {
	it('speichert gültige Anordnung und löscht mit null', async () => {
		const layout = { order: ['core:stats', 'events:upcoming'], hidden: ['core:stats'] };
		await setSetting(user, KEY, layout);
		expect(await getSetting(KEY, userId)).toEqual(layout);
		await setSetting(user, KEY, null);
		expect(await getSetting(KEY, userId)).toBeNull();
	});

	it('ungültige Anordnung → 422', async () => {
		expect(await codeOf(setSetting(user, KEY, { order: ['kein_gültiger'], hidden: [] }))).toBe(422);
		expect(await codeOf(setSetting(user, KEY, { order: [], hidden: [], extra: 1 }))).toBe(422);
		expect(
			await codeOf(
				setSetting(user, KEY, {
					order: Array.from({ length: 101 }, (_, i) => `core:w${i}`),
					hidden: []
				})
			)
		).toBe(422);
	});

	it('fremder Benutzer → 403', async () => {
		expect(
			await codeOf(setSetting(user, KEY, { order: [], hidden: [] }, { userId: adminId }))
		).toBe(403);
	});
});

describe('PUT /dashboard/layout', () => {
	it('speichert, liefert ok und lädt die Anordnung auf der Seite', async () => {
		const layout = { order: ['core:activity', 'core:stats'], hidden: ['core:quick-links'] };
		const res = await call(putLayout, { ctx: user, method: 'PUT', body: { layout } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		const page = (await (loadPage as (e: unknown) => Promise<unknown>)({
			locals: { ctx: user, user: { id: userId } }
		})) as { layout: unknown; activeModules: string[] };
		expect(page.layout).toEqual(layout);
		expect(Array.isArray(page.activeModules)).toBe(true);
	});

	it('null stellt den Standard wieder her', async () => {
		const res = await call(putLayout, { ctx: user, method: 'PUT', body: { layout: null } });
		expect(res.status).toBe(200);
		expect(await getSetting(KEY, userId)).toBeNull();
	});

	it('ungültiger Body → 422 mit deutscher Meldung', async () => {
		const res = await call(putLayout, {
			ctx: user,
			method: 'PUT',
			body: { layout: { order: ['Ungültig'], hidden: [] } }
		});
		expect(res.status).toBe(422);
		expect((await res.json()).message).toBe('Ungültige Dashboard-Anordnung');
		const missing = await call(putLayout, { ctx: user, method: 'PUT', body: {} });
		expect(missing.status).toBe(422);
	});

	it('ohne Login 401, fremde Herkunft 403', async () => {
		expect((await call(putLayout, { method: 'PUT', body: { layout: null } })).status).toBe(401);
		const foreign = await call(putLayout, {
			ctx: user,
			method: 'PUT',
			body: { layout: null },
			origin: 'https://evil.example'
		});
		expect(foreign.status).toBe(403);
		const none = await call(putLayout, {
			ctx: user,
			method: 'PUT',
			body: { layout: null },
			origin: null
		});
		expect(none.status).toBe(403);
	});

	it('ungültiger gespeicherter Wert → Seite liefert null', async () => {
		await getDb()
			.insert(schema.setting)
			.values({ key: KEY, scopeId: userId, value: { order: 'kaputt' }, updatedBy: userId });
		const page = (await (loadPage as (e: unknown) => Promise<unknown>)({
			locals: { ctx: user, user: { id: userId } }
		})) as { layout: unknown };
		expect(page.layout).toBeNull();
		await setSetting(user, KEY, null);
	});
});

describe('GET /dashboard/core', () => {
	it('ohne Login 401', async () => {
		expect((await call(getCore)).status).toBe(401);
	});

	it('Admin bekommt alle Felder, no-store', async () => {
		const res = await call(getCore, { ctx: admin });
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const { data } = await res.json();
		expect(data.users).toBeGreaterThanOrEqual(2);
		expect(typeof data.modules).toBe('number');
		expect(typeof data.apiKeys).toBe('number');
		expect(Array.isArray(data.recent)).toBe(true);
		expect(data.recent.length).toBeLessThanOrEqual(8);
	});

	it('ohne Rechte fehlen alle Felder', async () => {
		const res = await call(getCore, { ctx: user });
		expect(res.status).toBe(200);
		expect((await res.json()).data).toEqual({});
	});
});
