import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import {
	disableModule,
	enableModule,
	syncModules,
	useOptionalModuleService
} from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { listJobs, runDueJobs, runJobNow, setJobClockForTests } from '$lib/server/core/jobs';
import { defineModule } from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';

let admin: RequestContext;
let adminId: string;
let runs = 0;
let fail = false;
let close: () => Promise<void>;

const provider = defineModule({
	manifest: {
		id: 'jobprov',
		name: 'Anbieter',
		version: '1.0.0',
		dependencies: [],
		permissions: [],
		navigation: []
	},
	provides: { hello: () => 'hallo' },
	jobs: [
		{
			id: 'tick',
			summary: 'Test',
			schedule: 'daily',
			run: async (ctx) => {
				expect(ctx.actor.type).toBe('system');
				runs++;
				if (fail) throw new Error('kaputt');
				return `Lauf ${runs}`;
			}
		}
	]
});
const consumer = defineModule({
	manifest: {
		id: 'jobcons',
		name: 'Nutzer',
		version: '1.0.0',
		dependencies: [],
		optionalDependencies: ['jobprov'],
		permissions: [],
		navigation: []
	}
});

async function ctxOf(userId: string) {
	const r = await contextForUser(userId);
	if (!r) throw new Error('Kontext nicht auflösbar');
	return r.ctx;
}

let now = new Date('2026-10-16T08:00:00Z');

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(provider);
	registerModule(consumer);
	await syncModules();
	await bootstrapAdmin('admin@test.local', 'Sehr-Sicheres-Passwort-1');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@test.local'));
	adminId = u!.id;
	admin = await ctxOf(adminId);
	setJobClockForTests(() => now);
});

afterAll(async () => {
	setJobClockForTests(undefined);
	unregisterModule('jobprov');
	unregisterModule('jobcons');
	await close();
});

/** Fällige Jobs ohne stündliche Core-Jobs (deren Zahl ändert sich mit dem Core) */
async function runDaily(): Promise<string[]> {
	const hourly = new Set(
		(await listJobs()).filter((j) => j.schedule === 'hourly').map((j) => j.key)
	);
	return (await runDueJobs()).filter((k) => !hourly.has(k));
}

describe('Hintergrundjobs', () => {
	it('laufen nur für aktive Module (Core-Jobs immer)', async () => {
		expect(await runDaily()).toEqual(['core.housekeeping', 'core.notifications-digest']);
		expect(runs).toBe(0);
		await enableModule(admin, 'jobprov');
		expect(await runDaily()).toEqual(['jobprov.tick']);
		expect(runs).toBe(1);
	});

	it('laufen höchstens einmal je Intervall', async () => {
		now = new Date('2026-10-16T20:00:00Z');
		expect(await runDaily()).toEqual([]);
		now = new Date('2026-10-17T08:00:00Z');
		expect(await runDaily()).toEqual([
			'jobprov.tick',
			'core.housekeeping',
			'core.notifications-digest'
		]);
		expect(runs).toBe(2);
		const [info] = await listJobs();
		expect(info).toMatchObject({ key: 'jobprov.tick', lastStatus: 'ok', lastMessage: 'Lauf 2' });
	});

	it('protokollieren Fehler und lassen sich manuell auslösen', async () => {
		fail = true;
		const info = await runJobNow(admin, 'jobprov.tick');
		expect(info.lastStatus).toBe('error');
		expect(info.lastMessage).toBe('Error: kaputt');
		fail = false;
		await expect(runJobNow(admin, 'jobprov.unbekannt')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('Admin hat das neue Core-Recht', () => {
		expect(admin.permissions.has('core.jobs.manage')).toBe(true);
	});
});

describe('Optionale Abhängigkeiten', () => {
	it('liefert den Dienst nur, wenn der Anbieter aktiv ist', async () => {
		const svc = await useOptionalModuleService<{ hello: () => string }>('jobprov', 'jobcons');
		expect(svc?.hello()).toBe('hallo');
		await disableModule(admin, 'jobprov');
		expect(await useOptionalModuleService('jobprov', 'jobcons')).toBeNull();
	});

	it('verlangt die Deklaration', async () => {
		await expect(useOptionalModuleService('jobcons', 'jobprov')).rejects.toThrow(/optionale/);
	});
});
