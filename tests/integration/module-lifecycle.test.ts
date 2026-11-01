/**
 * Lebenszyklus installierter Module (Kalypzo Atrium, Phase 7) mit den Fixture-Modulen: Updates suchen, Entfernen
 * (Daten behalten bzw. löschen, Kopiermodus), Wunschzustand gegen laufenden Stand, Übernahme aus der Lock-Datei.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import {
	adminContext,
	disableModule,
	enableModule,
	getDb,
	registerCoreApi,
	registerModule,
	resetEnvForTests,
	runJobNow,
	schema,
	syncModules,
	useTestDatabase
} from '$testing';
import { setGithubFetchForTests } from '$lib/server/core/modules/install/github';
import {
	checkUpdates,
	installDrift,
	restoreFromDatabase,
	syncInstallsFromLock,
	uninstallModule
} from '$lib/server/core/modules/install/manage';
import { resetInstallSessionsForTests } from '$lib/server/core/modules/install/service';
import type { RequestContext } from '$lib/sdk/types';
import boardModule from '../fixtures/modules/fx-board/module';
import peopleModule from '../fixtures/modules/fx-people/module';
import { filesOf, makeZip } from '../helpers/module-zip';

const FIXTURES = join(__dirname, '..', 'fixtures', 'modules');
const PW = 'correct-horse-battery';
const OLD = '1'.repeat(40);
const HEAD = '2'.repeat(40);
let close: () => Promise<void>;
let admin: RequestContext;
let dir = '';

const schemaExists = async (name: string) =>
	(
		(await getDb().execute(sql`SELECT 1 FROM pg_namespace WHERE nspname = ${name}`)) as unknown as {
			rows: unknown[];
		}
	).rows.length > 0;

beforeAll(async () => {
	close = (await useTestDatabase()).close;
	registerCoreApi();
	registerModule(peopleModule);
	registerModule(boardModule);
	await syncModules();
	admin = await adminContext('lifecycle@example.test', PW);
	await enableModule(admin, 'fx-people');
	await enableModule(admin, 'fx-board');
	admin = await adminContext('lifecycle@example.test', PW);
	await runJobNow(admin, 'fx-board.tick');
	await getDb()
		.insert(schema.setting)
		.values({ key: 'fx-board.color', scopeId: '', value: '#ff0000' });
	dir = mkdtempSync(join(tmpdir(), 'atrium-lifecycle-'));
	cpSync(join(FIXTURES, 'fx-board'), join(dir, 'fx-board'), { recursive: true });
	const zip = makeZip(filesOf(FIXTURES), `org-mods-${HEAD.slice(0, 7)}/`);
	setGithubFetchForTests(async (url) => {
		const u = new URL(url);
		if (u.hostname === 'codeload.github.com') return new Response(zip as BodyInit);
		if (u.pathname === '/repos/org/mods/commits/main') {
			return new Response(JSON.stringify({ sha: HEAD }), { status: 200 });
		}
		if (u.pathname === `/repos/org/mods/zipball/${HEAD}`) {
			return new Response(null, {
				status: 302,
				headers: { location: `https://codeload.github.com/org/mods/legacy.zip/${HEAD}` }
			});
		}
		return new Response('{}', { status: 404 });
	});
});

afterAll(async () => {
	setGithubFetchForTests(null);
	for (const k of [
		'ATRIUM_MODULE_INSTALL',
		'ATRIUM_MODULES_DIR',
		'ATRIUM_DATA_DIR',
		'ATRIUM_GENERATION'
	])
		delete process.env[k];
	resetEnvForTests();
	resetInstallSessionsForTests();
	rmSync(dir, { recursive: true, force: true });
	await close();
});

describe('Updates', () => {
	it('vergleicht den gespeicherten Commit mit dem Kopf des Refs', async () => {
		const db = getDb();
		await db.insert(schema.moduleInstall).values([
			{
				id: 'fx-people',
				version: '0.9.0',
				sourceType: 'github',
				source: { owner: 'org', repo: 'mods', path: 'fx-people', ref: 'main' },
				commit: OLD,
				contentHash: 'sha256-alt'
			},
			{
				id: 'fx-consumer',
				version: '0.3.0',
				sourceType: 'upload',
				source: { fileName: 'c.zip', zipSha256: 'a'.repeat(64), path: '' },
				commit: null,
				contentHash: 'sha256-x'
			}
		]);
		const updates = await checkUpdates(admin);
		expect(updates.find((u) => u.id === 'fx-people')).toMatchObject({
			status: 'update',
			latestCommit: HEAD,
			latestVersion: '1.0.0',
			source: 'github:org/mods/fx-people#main'
		});
		expect(updates.find((u) => u.id === 'fx-consumer')?.status).toBe('no-source');
		await db
			.update(schema.moduleInstall)
			.set({ commit: HEAD })
			.where(eq(schema.moduleInstall.id, 'fx-people'));
		expect((await checkUpdates(admin)).find((u) => u.id === 'fx-people')?.status).toBe('current');
	});
});

describe('Wunschzustand und Lock-Datei', () => {
	it('nicht geladene Module aus der Datenbank werden als fehlend gemeldet', async () => {
		const drift = await installDrift(admin);
		expect(drift).toEqual([
			{
				id: 'fx-consumer',
				version: '0.3.0',
				source: 'ZIP c.zip',
				kind: 'missing',
				restorable: false
			}
		]);
	});

	it('Wiederherstellen braucht den Supervisor', async () => {
		await expect(restoreFromDatabase(admin, { password: PW })).rejects.toMatchObject({
			code: 'unavailable'
		});
	});

	it('Module aus der Lock-Datei (Seed) werden übernommen, eingebaute nicht', async () => {
		const data = mkdtempSync(join(tmpdir(), 'atrium-lock-'));
		mkdirSync(join(data, 'gen', 'g1'), { recursive: true });
		writeFileSync(
			join(data, 'gen', 'g1', 'atrium-modules.lock.json'),
			JSON.stringify({
				lockVersion: 1,
				core: '2.0.0',
				modules: {
					'fx-seeded': {
						version: '1.0.0',
						sourceType: 'github',
						source: { owner: 'org', repo: 'mods', path: 'fx-seeded', ref: HEAD },
						commit: HEAD,
						contentHash: 'sha256-s'
					},
					'fx-builtin': {
						version: '1.0.0',
						sourceType: 'builtin',
						source: {},
						commit: null,
						contentHash: 'sha256-b'
					}
				}
			})
		);
		process.env.ATRIUM_DATA_DIR = data;
		process.env.ATRIUM_GENERATION = 'g1';
		try {
			expect(await syncInstallsFromLock()).toBe(1);
			const rows = await getDb().select().from(schema.moduleInstall);
			expect(rows.map((r) => r.id)).toContain('fx-seeded');
			expect(rows.map((r) => r.id)).not.toContain('fx-builtin');
			expect(await syncInstallsFromLock()).toBe(0);
		} finally {
			delete process.env.ATRIUM_DATA_DIR;
			delete process.env.ATRIUM_GENERATION;
			rmSync(data, { recursive: true, force: true });
			await getDb().delete(schema.moduleInstall).where(eq(schema.moduleInstall.id, 'fx-seeded'));
		}
	});
});

describe('Entfernen', () => {
	it('aktives Modul → 409, falsche Bestätigung → 422, ohne Ausführmodus → 503 (Daten bleiben)', async () => {
		await expect(
			uninstallModule(admin, { id: 'fx-board', deleteData: false, password: PW })
		).rejects.toMatchObject({ code: 'conflict' });
		await disableModule(admin, 'fx-board');
		await expect(
			uninstallModule(admin, { id: 'fx-board', deleteData: true, confirmId: 'x', password: PW })
		).rejects.toMatchObject({ code: 'validation_failed' });
		await expect(
			uninstallModule(admin, {
				id: 'fx-board',
				deleteData: true,
				confirmId: 'fx-board',
				password: PW
			})
		).rejects.toMatchObject({ code: 'unavailable' });
		expect(await schemaExists('mod_fx_board')).toBe(true);
	});

	it('Kopiermodus mit „Daten löschen“: Ordner, Schema, Zustand, Rechte, Einstellungen, Job-Läufe weg', async () => {
		process.env.ATRIUM_MODULE_INSTALL = 'copy';
		process.env.ATRIUM_MODULES_DIR = dir;
		resetEnvForTests();
		try {
			const r = await uninstallModule(admin, {
				id: 'fx-board',
				deleteData: true,
				confirmId: 'fx-board',
				password: PW
			});
			expect(r).toMatchObject({ id: 'fx-board', dataDeleted: true, planId: null });
			expect(existsSync(join(dir, 'fx-board'))).toBe(false);
			expect(await schemaExists('mod_fx_board')).toBe(false);
			const db = getDb();
			expect(
				await db.select().from(schema.moduleState).where(eq(schema.moduleState.id, 'fx-board'))
			).toEqual([]);
			expect(
				await db.select().from(schema.permission).where(eq(schema.permission.moduleId, 'fx-board'))
			).toEqual([]);
			expect(
				await db.select().from(schema.setting).where(eq(schema.setting.key, 'fx-board.color'))
			).toEqual([]);
			expect(
				await db.select().from(schema.jobRun).where(eq(schema.jobRun.key, 'fx-board.tick'))
			).toEqual([]);
			const [ev] = await db
				.select()
				.from(schema.moduleInstallEvent)
				.where(eq(schema.moduleInstallEvent.moduleId, 'fx-board'));
			expect(ev).toMatchObject({ action: 'uninstall', status: 'done' });
		} finally {
			delete process.env.ATRIUM_MODULE_INSTALL;
			delete process.env.ATRIUM_MODULES_DIR;
			resetEnvForTests();
		}
	});

	it('nicht installiertes Modul mit Daten: nur Daten löschen geht auch ohne Ausführmodus', async () => {
		await disableModule(admin, 'fx-people');
		// Modul ohne Code (nicht registriert), aber mit Zustand und Schema
		await getDb()
			.insert(schema.moduleState)
			.values({ id: 'fx-old', enabled: false, installedVersion: '0.1.0' });
		await getDb().execute(sql.raw('CREATE SCHEMA IF NOT EXISTS "mod_fx_old"'));
		const r = await uninstallModule(admin, {
			id: 'fx-old',
			deleteData: true,
			confirmId: 'fx-old',
			password: PW
		});
		expect(r.dataDeleted).toBe(true);
		expect(await schemaExists('mod_fx_old')).toBe(false);
	});
});
