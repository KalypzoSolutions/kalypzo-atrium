/**
 * #65: Resilienz des Job-Runners – Wiederholung nach Fehlschlag (RETRY_MS), abgelaufene Sperren
 * vs. aktueller Heartbeat, Zeitfenster für `daily`-Jobs (Europe/Berlin) und Fehlerisolation
 * (Fehler beim Sperren oder Abschließen eines Jobs stoppt die übrigen nicht).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import {
	RETRY_MS,
	STALE_MS,
	dailyWindow,
	dueBefore,
	listJobs,
	runDueJobs,
	runJobNow,
	setJobClockForTests,
	setJobHeartbeatForTests
} from '$lib/server/core/jobs';
import { defineModule } from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';

type Row = Record<string, unknown>;

let admin: RequestContext;
let close: () => Promise<void>;
let now = new Date('2026-10-16T08:00:00Z'); // 10:00 Uhr in Berlin (Sommerzeit)

const runs = { fragile: 0, steady: 0 };
let fragileFails = false;
/** Wird im Lauf von `fragile` ausgeführt (z. B. Heartbeat beobachten, Übernahme simulieren) */
let duringFragile: (() => Promise<void>) | null = null;

const mod = defineModule({
	manifest: {
		id: 'jobres',
		name: 'Resilienz',
		version: '1.0.0',
		dependencies: [],
		permissions: [],
		navigation: []
	},
	jobs: [
		{
			id: 'fragile',
			summary: 'Kann fehlschlagen',
			schedule: 'daily',
			run: async () => {
				runs.fragile++;
				if (duringFragile) await duringFragile();
				if (fragileFails) throw new Error('SMTP nicht erreichbar');
				return 'ok';
			}
		},
		{
			id: 'steady',
			summary: 'Läuft immer',
			schedule: 'daily',
			run: async () => {
				runs.steady++;
				return 'ok';
			}
		}
	]
});

const rows = async (q: ReturnType<typeof sql>): Promise<Row[]> =>
	((await getDb().execute(q)) as unknown as { rows: Row[] }).rows;
const stateOf = async (key: string) =>
	(await rows(sql`SELECT * FROM job_run WHERE key = ${key}`))[0];
/** Fällige Jobs ohne stündliche (z. B. Core-Jobs anderer Teams), damit die Erwartungen stabil bleiben */
async function runDaily(): Promise<string[]> {
	const hourly = new Set(
		(await listJobs()).filter((j) => j.schedule === 'hourly').map((j) => j.key)
	);
	return (await runDueJobs()).filter((k) => !hourly.has(k));
}
const at = (s: string) => {
	now = new Date(s);
};
const minus = (ms: number) => new Date(now.getTime() - ms).toISOString();

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
	admin = (await contextForUser(u!.id))!.ctx;
	await enableModule(admin, 'jobres');
	admin = (await contextForUser(u!.id))!.ctx;
	setJobClockForTests(() => now);
});

afterEach(async () => {
	fragileFails = false;
	duringFragile = null;
	setJobHeartbeatForTests(undefined);
	delete process.env.JOBS_DAILY_WINDOW;
	await getDb().execute(sql`DROP TRIGGER IF EXISTS jobres_fault ON job_run`);
});

afterAll(async () => {
	setJobClockForTests(undefined);
	unregisterModule('jobres');
	await close();
});

describe('runJobNow: Rechteprüfung (#67)', () => {
	it('verlangt core.jobs.manage, auch ohne REST-Router', async () => {
		const noPerm = { ...admin, permissions: new Set<string>() };
		await expect(runJobNow(noPerm, 'jobres.steady')).rejects.toMatchObject({ code: 'forbidden' });
		expect(await stateOf('jobres.steady')).toBeUndefined();
	});
});

describe('Wiederholung nach Fehlschlag', () => {
	it('fehlgeschlagener daily-Job läuft nach RETRY_MS erneut, nicht erst am Folgetag', async () => {
		at('2026-10-16T08:00:00Z');
		fragileFails = true;
		expect(await runDaily()).toEqual(expect.arrayContaining(['jobres.fragile', 'jobres.steady']));
		expect((await stateOf('jobres.fragile'))?.last_status).toBe('error');
		expect(runs).toEqual({ fragile: 1, steady: 1 });

		// Vor Ablauf der Wartezeit: nichts
		now = new Date(now.getTime() + RETRY_MS - 60_000);
		expect(await runDaily()).toEqual([]);

		// Danach nur der fehlgeschlagene Job (der erfolgreiche erst am nächsten Tag)
		now = new Date(now.getTime() + 60_000);
		fragileFails = false;
		expect(await runDaily()).toEqual(['jobres.fragile']);
		expect(runs).toEqual({ fragile: 2, steady: 1 });
		expect((await stateOf('jobres.fragile'))?.last_status).toBe('ok');

		// Erfolgreich → wieder normales Intervall
		now = new Date(now.getTime() + RETRY_MS * 2);
		expect(await runDaily()).toEqual([]);
	});

	it('wiederholt außerhalb des Zeitfensters nicht', async () => {
		at('2026-10-17T17:55:00Z'); // 19:55 Berlin, Fenster endet 20:00
		fragileFails = true;
		expect(await runDaily()).toContain('jobres.fragile');
		at('2026-10-17T18:20:00Z'); // 20:20 Berlin
		fragileFails = false;
		expect(await runDaily()).toEqual([]);
		at('2026-10-18T04:00:00Z'); // 06:00 Berlin am Folgetag
		expect(await runDaily()).toEqual(expect.arrayContaining(['jobres.fragile', 'jobres.steady']));
	});
});

describe('Sperre, Heartbeat und abgelaufene Läufe', () => {
	it('übernimmt einen Lauf ohne Heartbeat nach STALE_MS, aber keinen mit aktuellem Heartbeat', async () => {
		at('2026-10-19T08:00:00Z');
		// Hängender Lauf mit frischem Heartbeat (Start vor 3 h, Heartbeat vor 2 min)
		await getDb().execute(sql`UPDATE job_run SET last_status = 'running',
			last_started_at = ${minus(3 * 3_600_000)}, last_finished_at = ${minus(120_000)}
			WHERE key = 'jobres.fragile'`);
		// Abgebrochener Lauf ohne Heartbeat (Start vor STALE_MS + 1 min)
		await getDb().execute(sql`UPDATE job_run SET last_status = 'running',
			last_started_at = ${minus(STALE_MS + 60_000)}, last_finished_at = NULL
			WHERE key = 'jobres.steady'`);
		const before = { ...runs };

		const ran = await runDaily();
		expect(ran).toContain('jobres.steady');
		expect(ran).not.toContain('jobres.fragile');
		expect(runs.steady).toBe(before.steady + 1);
		expect(runs.fragile).toBe(before.fragile);
		await expect(runJobNow(admin, 'jobres.fragile')).rejects.toMatchObject({ code: 'conflict' });

		// Läuft noch: kein Ende in der Liste (Heartbeat ist intern)
		const info = (await listJobs()).find((j) => j.key === 'jobres.fragile');
		expect(info).toMatchObject({ lastStatus: 'running', lastFinishedAt: null });

		// Heartbeat veraltet → übernehmen
		now = new Date(now.getTime() + STALE_MS);
		expect(await runDaily()).toEqual(['jobres.fragile']);
		expect((await stateOf('jobres.fragile'))?.last_status).toBe('ok');
	});

	it('ein laufender Job schreibt seinen Heartbeat fort und wird nicht doppelt gestartet', async () => {
		at('2026-10-19T09:00:00Z');
		setJobHeartbeatForTests(10);
		let seen: Row | undefined;
		let nested: unknown;
		duringFragile = async () => {
			now = new Date(now.getTime() + 5 * 60_000);
			await new Promise((r) => setTimeout(r, 80));
			seen = await stateOf('jobres.fragile');
			// Paralleler manueller Start während des Laufs → 409
			nested = await runJobNow(admin, 'jobres.fragile').catch((e) => e);
		};
		await runJobNow(admin, 'jobres.fragile');
		expect(seen?.last_status).toBe('running');
		expect(new Date(String(seen?.last_finished_at)).toISOString()).toBe(now.toISOString());
		expect(nested).toMatchObject({ code: 'conflict' });
		expect((await stateOf('jobres.fragile'))?.last_status).toBe('ok');
	});

	it('ein übernommener Lauf überschreibt beim Abschluss nicht den neuen Besitzer', async () => {
		at('2026-10-19T10:00:00Z');
		const takeover = minus(-1000);
		duringFragile = async () => {
			// Simuliert: Sperre lief ab und eine andere Instanz hat übernommen
			await getDb().execute(
				sql`UPDATE job_run SET last_started_at = ${takeover} WHERE key = 'jobres.fragile'`
			);
		};
		await runJobNow(admin, 'jobres.fragile');
		const r = await stateOf('jobres.fragile');
		expect(r?.last_status).toBe('running');
		expect(new Date(String(r?.last_started_at)).toISOString()).toBe(takeover);
		// Aufräumen: Lauf als beendet markieren
		await getDb().execute(
			sql`UPDATE job_run SET last_status = 'ok', last_finished_at = now() WHERE key = 'jobres.fragile'`
		);
	});
});

describe('Zeitfenster für daily-Jobs', () => {
	it('startet erst ab 06:00 Uhr Berliner Zeit', async () => {
		at('2026-10-20T03:30:00Z'); // 05:30 Berlin
		expect(await runDaily()).toEqual([]);
		at('2026-10-20T04:00:00Z'); // 06:00 Berlin
		expect(await runDaily()).toEqual(
			expect.arrayContaining(['jobres.fragile', 'jobres.steady', 'core.housekeeping'])
		);
		// Am selben Tag kein zweiter Lauf
		at('2026-10-20T17:00:00Z');
		expect(await runDaily()).toEqual([]);
	});

	it('Fenster ist per JOBS_DAILY_WINDOW einstellbar', async () => {
		process.env.JOBS_DAILY_WINDOW = '22-24';
		at('2026-10-21T19:00:00Z'); // 21:00 Berlin
		expect(await runDaily()).toEqual([]);
		at('2026-10-21T20:30:00Z'); // 22:30 Berlin
		expect(await runDaily()).toContain('jobres.steady');
	});

	it('berechnet das Fenster in Sommer- und Winterzeit', () => {
		expect(dailyWindow(undefined)).toEqual({ from: 6, to: 20 });
		expect(dailyWindow('7-9')).toEqual({ from: 7, to: 9 });
		expect(dailyWindow('9-7')).toEqual({ from: 6, to: 20 });
		expect(dailyWindow('0-25')).toEqual({ from: 6, to: 20 });
		expect(dailyWindow('abc')).toEqual({ from: 6, to: 20 });
		// Sommerzeit (UTC+2): 06:00 Berlin = 04:00 UTC
		expect(dueBefore('daily', new Date('2026-07-01T10:00:00Z'))?.toISOString()).toBe(
			'2026-07-01T04:00:00.000Z'
		);
		// Winterzeit (UTC+1): 06:00 Berlin = 05:00 UTC
		expect(dueBefore('daily', new Date('2026-12-01T10:00:00Z'))?.toISOString()).toBe(
			'2026-12-01T05:00:00.000Z'
		);
		// Tag der Umstellung (25.10.2026, 03:00 → 02:00): 06:00 Berlin = 05:00 UTC
		expect(dueBefore('daily', new Date('2026-10-25T09:00:00Z'))?.toISOString()).toBe(
			'2026-10-25T05:00:00.000Z'
		);
		// Kurz vor Mitternacht UTC ist in Berlin schon der nächste Tag (außerhalb des Fensters)
		expect(dueBefore('daily', new Date('2026-07-01T22:30:00Z'))).toBeNull();
		expect(dueBefore('daily', new Date('2026-07-01T18:00:00Z'))).toBeNull(); // 20:00 Berlin
		// hourly bleibt ein Intervall
		expect(dueBefore('hourly', new Date('2026-07-01T10:00:00Z'))?.getTime()).toBe(
			new Date('2026-07-01T09:05:00Z').getTime() + 1
		);
	});
});

describe('Fehlerisolation', () => {
	it('ein Fehler beim Abschluss (finish) verhindert die übrigen Jobs nicht', async () => {
		at('2026-10-22T08:00:00Z');
		await getDb().execute(sql`CREATE OR REPLACE FUNCTION jobres_fault() RETURNS trigger AS $$
			BEGIN
				IF NEW.key = 'jobres.fragile' AND NEW.last_status <> 'running' THEN
					RAISE EXCEPTION 'Datenbank nicht erreichbar';
				END IF;
				RETURN NEW;
			END $$ LANGUAGE plpgsql`);
		await getDb().execute(
			sql`CREATE TRIGGER jobres_fault BEFORE UPDATE ON job_run FOR EACH ROW EXECUTE FUNCTION jobres_fault()`
		);
		const before = { ...runs };
		const ran = await runDaily();
		expect(ran).toEqual(
			expect.arrayContaining(['jobres.fragile', 'jobres.steady', 'core.housekeeping'])
		);
		expect(runs).toEqual({ fragile: before.fragile + 1, steady: before.steady + 1 });
		// Ohne Abschluss bleibt der Lauf gesperrt, bis die Sperre abläuft
		expect((await stateOf('jobres.fragile'))?.last_status).toBe('running');
		expect((await stateOf('jobres.steady'))?.last_status).toBe('ok');
		await getDb().execute(sql`DROP TRIGGER jobres_fault ON job_run`);
		now = new Date(now.getTime() + STALE_MS);
		expect(await runDaily()).toEqual(['jobres.fragile']);
		expect((await stateOf('jobres.fragile'))?.last_status).toBe('ok');
	});

	it('ein Fehler beim Sperren eines Jobs verhindert die übrigen Jobs nicht', async () => {
		at('2026-10-23T08:00:00Z');
		await getDb().execute(sql`CREATE OR REPLACE FUNCTION jobres_fault() RETURNS trigger AS $$
			BEGIN
				IF NEW.key = 'jobres.fragile' THEN RAISE EXCEPTION 'Sperre kaputt'; END IF;
				RETURN NEW;
			END $$ LANGUAGE plpgsql`);
		await getDb().execute(
			sql`CREATE TRIGGER jobres_fault BEFORE UPDATE ON job_run FOR EACH ROW EXECUTE FUNCTION jobres_fault()`
		);
		const before = { ...runs };
		const ran = await runDaily();
		expect(ran).not.toContain('jobres.fragile');
		expect(ran).toEqual(expect.arrayContaining(['jobres.steady', 'core.housekeeping']));
		expect(runs).toEqual({ fragile: before.fragile, steady: before.steady + 1 });
	});
});
