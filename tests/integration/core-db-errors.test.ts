/**
 * #55 / #56: Unique-Verletzungen hinter der Drizzle-Hülle → 409, Fehler-Logs und `job_run`
 * ohne SQL-Parameterwerte.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { defineEndpoint } from '$lib/server/core/api/registry';
import { createRole, updateRole } from '$lib/server/core/permissions/roles';
import {
	LEGACY_JOB_MESSAGE,
	listJobs,
	neutralizeLegacyJobMessages,
	runJobNow
} from '$lib/server/core/jobs';
import { defineModule } from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';

/** Erkennbarer Parameterwert, der nirgends auftauchen darf */
const MARKER = 'GEHEIM-Geburtsdatum-2014-03-07';

let admin: RequestContext;
let token: string;
let close: () => Promise<void>;

const mod = defineModule({
	manifest: {
		id: 'dberr',
		name: 'DB-Fehler',
		version: '1.0.0',
		dependencies: [],
		permissions: ['dberr.item.edit'],
		navigation: []
	},
	endpoints: [
		defineEndpoint({
			method: 'POST',
			path: '/dup',
			summary: 'Erzeugt eine nicht abgefangene Unique-Verletzung',
			permission: 'dberr.item.edit',
			handler: async () => {
				await getDb().insert(schema.role).values({ id: crypto.randomUUID(), name: MARKER });
				return null;
			}
		}),
		defineEndpoint({
			method: 'POST',
			path: '/bad',
			summary: 'Erzeugt einen anderen DB-Fehler (ungültige UUID)',
			permission: 'dberr.item.edit',
			handler: async () => {
				await getDb().execute(sql`SELECT ${MARKER}::uuid AS id`);
				return null;
			}
		})
	],
	jobs: [
		{
			id: 'boom',
			summary: 'Job mit DB-Fehler',
			schedule: 'daily',
			run: async () => {
				await getDb().insert(schema.role).values({ id: crypto.randomUUID(), name: MARKER });
				return 'nie';
			}
		}
	]
});

function api(path: string, body: unknown) {
	const url = new URL(`http://localhost:5173/api/v1${path}`);
	return handleApiRequest({
		request: new Request(url, {
			method: 'POST',
			body: JSON.stringify(body),
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
		}),
		url,
		ip: '127.0.0.1'
	});
}

async function ctxOf(userId: string) {
	const r = await contextForUser(userId);
	if (!r) throw new Error('Kontext nicht auflösbar');
	return r.ctx;
}

/** Alles, was `console.error` bekommen hat, als ein String */
function logged(spy: { mock: { calls: unknown[][] } }): string {
	return spy.mock.calls
		.map((c) => c.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
		.join('\n');
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(mod);
	await syncModules();
	await bootstrapAdmin('admin@test.local', 'Sehr-Sicheres-Passwort-1');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@test.local'));
	admin = await ctxOf(u!.id);
	await enableModule(admin, 'dberr');
	admin = await ctxOf(u!.id);
	({ key: token } = await createApiKey(admin, {
		name: 'k',
		scopes: ['core.roles.create', 'dberr.item.edit']
	}));
	await createRole(admin, { name: MARKER, permissions: [] });
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
	unregisterModule('dberr');
	await close();
});

describe('Unique-Verletzungen (#55)', () => {
	it('doppelter Rollenname → 409 conflict (Service)', async () => {
		await expect(createRole(admin, { name: MARKER, permissions: [] })).rejects.toMatchObject({
			code: 'conflict',
			status: 409,
			message: 'Rollenname bereits vergeben'
		});
	});

	it('Umbenennen auf vergebenen Namen → 409', async () => {
		const id = await createRole(admin, { name: 'Andere Rolle', permissions: [] });
		await expect(updateRole(admin, id, { name: MARKER })).rejects.toMatchObject({
			code: 'conflict'
		});
	});

	it('doppelter Rollenname über die API → 409 mit deutschem Text', async () => {
		const res = await api('/roles', { name: MARKER, permissions: [] });
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toMatchObject({ code: 'conflict', message: 'Rollenname bereits vergeben' });
	});

	it('nicht abgefangene Unique-Verletzung → generisch 409, Log ohne Parameterwerte', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await api('/modules/dberr/dup', {});
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error.code).toBe('conflict');
		expect(body.error.message).toBe('Ein Eintrag mit diesen Angaben existiert bereits');
		expect(JSON.stringify(body)).not.toContain(MARKER);
		const log = logged(spy);
		expect(log).toContain('23505');
		expect(log).toContain(body.error.requestId);
		expect(log).not.toContain(MARKER);
	});
});

describe('Fehler-Logs ohne Parameter (#56)', () => {
	it('500er loggen SQLSTATE, requestId und Stack, aber keine Werte; Client sieht keinen Stack', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const res = await api('/modules/dberr/bad', {});
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error).toEqual({
			code: 'internal_error',
			message: 'Interner Serverfehler',
			requestId: body.error.requestId
		});
		const log = logged(spy);
		expect(log).toContain('22P02');
		expect(log).toContain(body.error.requestId);
		expect(log).toMatch(/\n\s+at /);
		expect(log).not.toContain(MARKER);
	});

	it('job_run.last_message und listJobs enthalten nach einem DB-Fehler keine Werte', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const info = await runJobNow(admin, 'dberr.boom');
		expect(info.lastStatus).toBe('error');
		expect(info.lastMessage).toContain('23505');
		expect(info.lastMessage).not.toContain(MARKER);
		expect(info.lastMessage).not.toContain('params');
		const rows = await getDb()
			.select()
			.from(schema.jobRun)
			.where(eq(schema.jobRun.key, 'dberr.boom'));
		expect(rows[0]!.lastMessage).not.toContain(MARKER);
	});

	it('Altbestände mit SQL-Parametern werden neutralisiert', async () => {
		const legacy = `Failed query: insert into "role" ("id", "name") values ($1, $2)\nparams: x,${MARKER}`;
		await getDb()
			.update(schema.jobRun)
			.set({ lastMessage: legacy })
			.where(eq(schema.jobRun.key, 'dberr.boom'));
		// Lesen maskiert sofort …
		const listed = (await listJobs()).find((j) => j.key === 'dberr.boom');
		expect(listed!.lastMessage).toBe('Fehler (Details aus Datenschutzgründen entfernt)');
		// … der Startlauf bereinigt die Tabelle
		expect(await neutralizeLegacyJobMessages()).toBe(1);
		const rows = await getDb()
			.select()
			.from(schema.jobRun)
			.where(eq(schema.jobRun.key, 'dberr.boom'));
		expect(rows[0]!.lastMessage).toBe(LEGACY_JOB_MESSAGE);
		expect(await neutralizeLegacyJobMessages()).toBe(0);
	});
});
