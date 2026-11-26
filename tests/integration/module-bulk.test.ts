/**
 * Sammelaktionen der Modulverwaltung mit den Fixture-Modulen (`fx-consumer` braucht `fx-board` hart):
 * Aktivieren/Deaktivieren in Abhängigkeitsreihenfolge, Teilfehler, `withDependencies`, Rechte; Sammel-Entfernen
 * mit gemeinsamen Prüfungen, einer Re-Auth und EINEM Supervisor-Neubau.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { bulkModuleAction } from '$lib/server/core/modules/bulk';
import { checkUpdates, uninstallModules } from '$lib/server/core/modules/install/manage';
import { enabledModuleIds, invalidateModuleStateCache } from '$lib/server/core/modules/state';
import {
	adminContext,
	contextForUser,
	createRole,
	createUser,
	disableModule,
	enableModule,
	getDb,
	listAudit,
	registerCoreApi,
	registerModule,
	resetEnvForTests,
	schema,
	syncModules,
	useTestDatabase
} from '$testing';
import boardModule from '../fixtures/modules/fx-board/module';
import consumerModule from '../fixtures/modules/fx-consumer/module';
import peopleModule from '../fixtures/modules/fx-people/module';

const PW = 'correct-horse-battery';
let close: () => Promise<void>;
let admin: RequestContext;

const enabled = async () => {
	invalidateModuleStateCache();
	return enabledModuleIds();
};

beforeAll(async () => {
	close = (await useTestDatabase()).close;
	registerCoreApi();
	registerModule(peopleModule);
	registerModule(boardModule);
	registerModule(consumerModule);
	await syncModules();
	admin = await adminContext('bulk@example.test', PW);
});

afterAll(async () => {
	await close();
});

describe('bulkModuleAction', () => {
	it('aktiviert Abhängigkeiten zuerst, auch bei anderer Auswahlreihenfolge', async () => {
		const r = await bulkModuleAction(admin, {
			action: 'enable',
			ids: ['fx-consumer', 'fx-board']
		});
		expect(r.results).toEqual([
			{ id: 'fx-board', ok: true },
			{ id: 'fx-consumer', ok: true }
		]);
		expect(r.addedDependencies).toEqual([]);
		const on = await enabled();
		expect(on.has('fx-board') && on.has('fx-consumer')).toBe(true);
	});

	it('bereits aktive Module werden übersprungen', async () => {
		const r = await bulkModuleAction(admin, { action: 'enable', ids: ['fx-board'] });
		expect(r.results).toEqual([{ id: 'fx-board', ok: true, skipped: true }]);
	});

	it('deaktiviert abhängige Module zuerst', async () => {
		const r = await bulkModuleAction(admin, {
			action: 'disable',
			ids: ['fx-board', 'fx-consumer']
		});
		expect(r.results.map((x) => [x.id, x.ok])).toEqual([
			['fx-consumer', true],
			['fx-board', true]
		]);
		const on = await enabled();
		expect(on.has('fx-board') || on.has('fx-consumer')).toBe(false);
	});

	it('Teilfehler (unbekannt, Abhängigkeit inaktiv) blockieren den Rest nicht', async () => {
		const r = await bulkModuleAction(admin, {
			action: 'enable',
			ids: ['fx-consumer', 'fx-gibtsnicht', 'fx-people']
		});
		const byId = new Map(r.results.map((x) => [x.id, x]));
		expect(byId.get('fx-gibtsnicht')).toMatchObject({ ok: false });
		expect(byId.get('fx-gibtsnicht')?.message).toContain('fx-gibtsnicht');
		expect(byId.get('fx-consumer')).toMatchObject({ ok: false });
		expect(byId.get('fx-consumer')?.message).toContain('fx-board');
		expect(byId.get('fx-people')).toEqual({ id: 'fx-people', ok: true });
		const on = await enabled();
		expect(on.has('fx-people')).toBe(true);
		expect(on.has('fx-consumer')).toBe(false);
	});

	it('Deaktivieren eines benötigten Moduls scheitert einzeln', async () => {
		await enableModule(admin, 'fx-board');
		await enableModule(admin, 'fx-consumer');
		const r = await bulkModuleAction(admin, { action: 'disable', ids: ['fx-board', 'fx-people'] });
		const byId = new Map(r.results.map((x) => [x.id, x]));
		expect(byId.get('fx-board')).toMatchObject({ ok: false });
		expect(byId.get('fx-board')?.message).toContain('fx-consumer');
		expect(byId.get('fx-people')).toEqual({ id: 'fx-people', ok: true });
		await disableModule(admin, 'fx-consumer');
		await disableModule(admin, 'fx-board');
	});

	it('withDependencies aktiviert fehlende harte Abhängigkeiten mit', async () => {
		const r = await bulkModuleAction(admin, {
			action: 'enable',
			ids: ['fx-consumer'],
			withDependencies: true
		});
		expect(r.addedDependencies).toEqual(['fx-board']);
		expect(r.results).toEqual([
			{ id: 'fx-board', ok: true, addedAsDependency: true },
			{ id: 'fx-consumer', ok: true }
		]);
		await bulkModuleAction(admin, { action: 'disable', ids: ['fx-board', 'fx-consumer'] });
	});

	it('leere oder zu große Auswahl → 422', async () => {
		await expect(bulkModuleAction(admin, { action: 'enable', ids: [] })).rejects.toMatchObject({
			code: 'validation_failed'
		});
		const many = Array.from({ length: 101 }, (_, i) => `fx-m${i}`);
		await expect(bulkModuleAction(admin, { action: 'enable', ids: many })).rejects.toMatchObject({
			code: 'validation_failed'
		});
	});

	it('ohne core.modules.manage → 403', async () => {
		const roleId = await createRole(admin, {
			name: 'Module ansehen',
			permissions: ['core.modules.view']
		});
		const id = await createUser(admin, {
			name: 'Leser',
			email: 'module-reader@example.test',
			password: PW,
			roleIds: [roleId]
		});
		const reader = (await contextForUser(id))!.ctx;
		await expect(
			bulkModuleAction(reader, { action: 'enable', ids: ['fx-board'] })
		).rejects.toMatchObject({ code: 'forbidden' });
		await expect(
			uninstallModules(reader, { ids: ['fx-board'], deleteData: false, password: PW })
		).rejects.toMatchObject({ code: 'forbidden' });
	});
});

describe('checkUpdates mit Auswahl', () => {
	it('prüft nur die ausgewählten Module', async () => {
		await getDb()
			.insert(schema.moduleInstall)
			.values([
				{
					id: 'fx-board',
					version: '1.2.0',
					sourceType: 'upload',
					source: { fileName: 'b.zip', zipSha256: 'b'.repeat(64), path: '' },
					commit: null,
					contentHash: 'sha256-b'
				},
				{
					id: 'fx-consumer',
					version: '0.3.0',
					sourceType: 'upload',
					source: { fileName: 'c.zip', zipSha256: 'c'.repeat(64), path: '' },
					commit: null,
					contentHash: 'sha256-c'
				}
			]);
		expect((await checkUpdates(admin)).map((u) => u.id)).toEqual(['fx-board', 'fx-consumer']);
		expect((await checkUpdates(admin, ['fx-consumer'])).map((u) => u.id)).toEqual(['fx-consumer']);
	});
});

describe('uninstallModules', () => {
	it('abhängige Module außerhalb der Auswahl → 409', async () => {
		await expect(
			uninstallModules(admin, { ids: ['fx-board'], deleteData: false, password: PW })
		).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('fx-consumer') });
	});

	it('aktive Module → 409 mit IDs, unbekannte → 404', async () => {
		await enableModule(admin, 'fx-people');
		await expect(
			uninstallModules(admin, { ids: ['fx-people', 'fx-board'], deleteData: false, password: PW })
		).rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('fx-people') });
		await disableModule(admin, 'fx-people');
		await expect(
			uninstallModules(admin, { ids: ['fx-nix'], deleteData: false, password: PW })
		).rejects.toMatchObject({ code: 'not_found' });
	});

	it('falsches Passwort → 422 (password), falsches Bestätigungswort → 422 (confirm)', async () => {
		await expect(
			uninstallModules(admin, {
				ids: ['fx-board', 'fx-consumer'],
				deleteData: false,
				password: 'falsch-falsch-falsch'
			})
		).rejects.toMatchObject({
			code: 'validation_failed',
			details: [expect.objectContaining({ path: ['password'] })]
		});
		await expect(
			uninstallModules(admin, {
				ids: ['fx-board', 'fx-consumer'],
				deleteData: true,
				confirm: 'fx-board',
				password: PW
			})
		).rejects.toMatchObject({
			code: 'validation_failed',
			details: [expect.objectContaining({ path: ['confirm'] })]
		});
	});

	it('ein Supervisor-Neubau für mehrere Module, Event und Audit je Modul', async () => {
		const data = mkdtempSync(join(tmpdir(), 'atrium-bulk-'));
		const sent: unknown[] = [];
		const originalSend = process.send;
		process.env.ATRIUM_MODULE_INSTALL = 'supervisor';
		process.env.ATRIUM_SUPERVISOR = '1';
		process.env.ATRIUM_DATA_DIR = data;
		process.send = ((msg: unknown) => {
			sent.push(msg);
			return true;
		}) as typeof process.send;
		resetEnvForTests();
		try {
			const r = await uninstallModules(admin, {
				ids: ['fx-board', 'fx-consumer'],
				deleteData: true,
				confirm: 'ENTFERNEN',
				password: PW
			});
			expect(r.planId).toMatch(/^[a-f0-9]{32}$/);
			expect(r.ids).toEqual(['fx-board', 'fx-consumer']);
			expect(r.results.map((x) => x.planId)).toEqual([r.planId, r.planId]);
			expect(sent).toEqual([{ type: 'atrium:build', planId: r.planId }]);
			const request = JSON.parse(
				readFileSync(join(data, 'staging', r.planId!, 'request.json'), 'utf8')
			) as { remove: string[]; modules: object };
			expect(request.remove).toEqual(['fx-board', 'fx-consumer']);
			expect(request.modules).toEqual({});

			const db = getDb();
			const events = await db
				.select()
				.from(schema.moduleInstallEvent)
				.where(eq(schema.moduleInstallEvent.planId, r.planId!));
			expect(events.map((e) => e.moduleId).sort()).toEqual(['fx-board', 'fx-consumer']);
			for (const e of events) {
				expect(e).toMatchObject({ action: 'uninstall', status: 'requested' });
			}
			expect(
				await db
					.select()
					.from(schema.moduleInstall)
					.where(inArray(schema.moduleInstall.id, ['fx-board', 'fx-consumer']))
			).toEqual([]);
			expect(
				await db
					.select()
					.from(schema.moduleState)
					.where(inArray(schema.moduleState.id, ['fx-board', 'fx-consumer']))
			).toEqual([]);

			const audit = (await listAudit({ action: 'core.module.uninstalled' })).rows;
			expect(audit.map((a) => a.target).sort()).toEqual(['fx-board', 'fx-consumer']);
			for (const a of audit) {
				expect(a.metadata).toEqual({
					dataDeleted: true,
					planId: r.planId,
					bulk: true,
					count: 2
				});
			}
		} finally {
			process.send = originalSend;
			for (const k of ['ATRIUM_MODULE_INSTALL', 'ATRIUM_SUPERVISOR', 'ATRIUM_DATA_DIR']) {
				delete process.env[k];
			}
			resetEnvForTests();
			rmSync(data, { recursive: true, force: true });
		}
	});
	it('protokolliert gelöschte Daten auch bei fehlgeschlagener Supervisor-Anforderung', async () => {
		const data = mkdtempSync(join(tmpdir(), 'atrium-bulk-fail-'));
		const originalSend = process.send;
		process.env.ATRIUM_MODULE_INSTALL = 'supervisor';
		process.env.ATRIUM_SUPERVISOR = '1';
		process.env.ATRIUM_DATA_DIR = data;
		process.send = (() => {
			throw new Error('Supervisor nicht erreichbar');
		}) as typeof process.send;
		resetEnvForTests();
		try {
			const result = await uninstallModules(admin, {
				ids: ['fx-people'],
				deleteData: true,
				confirm: 'ENTFERNEN',
				password: PW
			});
			expect(result.results[0]).toMatchObject({ dataDeleted: true });
			expect(result.warnings.join(' ')).toContain('Supervisor nicht erreichbar');
			const events = await getDb()
				.select()
				.from(schema.moduleInstallEvent)
				.where(eq(schema.moduleInstallEvent.moduleId, 'fx-people'));
			expect(events.at(-1)).toMatchObject({
				status: 'failed',
				detail: 'install.detail.removedDataDeleted'
			});
			expect((await listAudit({ action: 'core.module.uninstalled' })).rows).toContainEqual(
				expect.objectContaining({
					target: 'fx-people',
					metadata: expect.objectContaining({ dataDeleted: true })
				})
			);
		} finally {
			process.send = originalSend;
			for (const k of ['ATRIUM_MODULE_INSTALL', 'ATRIUM_SUPERVISOR', 'ATRIUM_DATA_DIR'])
				delete process.env[k];
			resetEnvForTests();
			rmSync(data, { recursive: true, force: true });
		}
	});
});
