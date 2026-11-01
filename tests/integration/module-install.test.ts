/**
 * Modul-Installation (Kalypzo Atrium, Phase 5) gegen einen GitHub-Ersatz und die Fixture-Module:
 * Rechte, Quelle lesen, Vorschau mit Abhängigkeiten (gleiches Repository und `source`-Link), erneute Anmeldung,
 * Modus `off`/`copy`, veränderte angewendete Migration, erlaubte Quellen, Verlauf.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	adminContext,
	createRole,
	createUser,
	contextForUser,
	enableModule,
	getDb,
	listAudit,
	registerCoreApi,
	registerModule,
	resetEnvForTests,
	schema,
	setSetting,
	syncModules,
	useTestDatabase
} from '$testing';
import { setGithubFetchForTests } from '$lib/server/core/modules/install/github';
import {
	confirmInstall,
	inspectSource,
	listInstallEvents,
	previewInstall,
	resetInstallSessionsForTests
} from '$lib/server/core/modules/install/service';
import type { RequestContext } from '$lib/sdk/types';
import boardModule from '../fixtures/modules/fx-board/module';
import { filesOf, makeZip } from '../helpers/module-zip';

const FIXTURES = join(__dirname, '..', 'fixtures', 'modules');
const SHA = 'a'.repeat(40);
const OWNER = 'kalypzo';
const REPO = 'atrium-fixtures';
const ADMIN = 'installer@example.test';
const PW = 'correct-horse-battery';

let close: () => Promise<void>;
let admin: RequestContext;
let target = '';
const calls: string[] = [];

/** Repository wie bei GitHub: Katalog + drei Module, Oberordner `<owner>-<repo>-<sha>/` */
function repoZip(override: Record<string, string> = {}): Uint8Array {
	return makeZip({ ...filesOf(FIXTURES), ...override }, `${OWNER}-${REPO}-${SHA.slice(0, 7)}/`);
}

let zipball = repoZip();

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

beforeAll(async () => {
	close = (await useTestDatabase()).close;
	registerCoreApi();
	await syncModules();
	admin = await adminContext(ADMIN, PW);
	target = mkdtempSync(join(tmpdir(), 'atrium-install-'));
	setGithubFetchForTests(async (url) => {
		calls.push(url);
		const u = new URL(url);
		const base = `/repos/${OWNER}/${REPO}`;
		if (u.hostname === 'codeload.github.com') {
			return new Response(zipball as BodyInit, { status: 200 });
		}
		if (u.pathname === base) return json({ default_branch: 'main' });
		if (u.pathname === `${base}/commits/main` || u.pathname === `${base}/commits/${SHA}`) {
			return json({ sha: SHA });
		}
		if (u.pathname.startsWith(`${base}/commits/`)) return json({ message: 'No commit' }, 422);
		if (u.pathname === `${base}/zipball/${SHA}`) {
			return new Response(null, {
				status: 302,
				headers: { location: `https://codeload.github.com/${OWNER}/${REPO}/legacy.zip/${SHA}` }
			});
		}
		return json({ message: 'Not Found' }, 404);
	});
});

afterAll(async () => {
	setGithubFetchForTests(null);
	delete process.env.ATRIUM_MODULE_INSTALL;
	resetEnvForTests();
	rmSync(target, { recursive: true, force: true });
	await close();
});

beforeEach(() => {
	resetInstallSessionsForTests();
	zipball = repoZip();
});

describe('Rechte', () => {
	it('ohne Administrator-Rechte bzw. per API-Key → 403', async () => {
		const roleId = await createRole(admin, {
			name: 'Installateur*in',
			permissions: ['core.modules.install', 'core.modules.view']
		});
		const userId = await createUser(admin, {
			name: 'Ina Installateurin',
			email: 'ina@example.test',
			password: PW,
			roleIds: [roleId]
		});
		const ina = (await contextForUser(userId))!.ctx;
		await expect(inspectSource(ina, { url: `${OWNER}/${REPO}` })).rejects.toMatchObject({
			code: 'forbidden'
		});
		const apiKeyCtx: RequestContext = {
			...admin,
			actor: { type: 'api_key', id: 'k', name: 'Key' }
		};
		await expect(inspectSource(apiKeyCtx, { url: `${OWNER}/${REPO}` })).rejects.toMatchObject({
			code: 'forbidden'
		});
	});
});

describe('Quelle und Vorschau', () => {
	it('GitHub-Link: Katalog lesen, Ref → Commit', async () => {
		const src = await inspectSource(admin, { url: `https://github.com/${OWNER}/${REPO}` });
		expect(src.commit).toBe(SHA);
		expect(src.label).toBe(`github:${OWNER}/${REPO}#main`);
		expect(src.catalogName).toMatch(/Test-Fixtures/);
		expect(src.modules.map((m) => m.id)).toEqual(['fx-board', 'fx-consumer', 'fx-people']);
		// Weiterleitung auf codeload, Token nie dorthin
		expect(calls.some((c) => c.startsWith('https://codeload.github.com/'))).toBe(true);
	});

	it('Auswahl mit harter Abhängigkeit: fx-board kommt dazu, fx-people wird empfohlen', async () => {
		const src = await inspectSource(admin, { url: `${OWNER}/${REPO}` });
		const preview = await previewInstall(admin, {
			sourceToken: src.token,
			selected: ['fx-consumer']
		});
		expect(preview.blockers).toEqual([]);
		expect(preview.entries.map((e) => [e.id, e.reason, e.action])).toEqual([
			['fx-board', 'dependency', 'install'],
			['fx-consumer', 'selected', 'install']
		]);
		const board = preview.entries[0]!;
		expect(board.newMigrations).toEqual(['0001_init', '0002_events']);
		expect(board.permissionsAdded).toContain('fx-board.note.view');
		expect(board.commit).toBe(SHA);
		expect(board.origin).toBe(`github:${OWNER}/${REPO}/fx-board#main`);
		expect(preview.recommended).toEqual([
			{ id: 'fx-people', requiredBy: 'fx-consumer', available: true }
		]);
		expect(preview.status.available).toBe(false);
	});

	it('ZIP mit nur fx-consumer: fx-board wird über den source-Link von GitHub geholt', async () => {
		const zip = makeZip(filesOf(join(FIXTURES, 'fx-consumer')), 'fx-consumer/');
		const src = await inspectSource(admin, { zip, fileName: 'fx-consumer.zip' });
		expect(src.modules.map((m) => m.id)).toEqual(['fx-consumer']);
		const preview = await previewInstall(admin, {
			sourceToken: src.token,
			selected: ['fx-consumer']
		});
		expect(preview.blockers).toEqual([]);
		expect(preview.entries.map((e) => [e.id, e.origin])).toEqual([
			['fx-board', `github:${OWNER}/${REPO}/fx-board#main`],
			['fx-consumer', 'ZIP fx-consumer.zip']
		]);
	});

	it('abgelaufene oder fremde Vorschau → 404', async () => {
		await expect(
			previewInstall(admin, { sourceToken: 'nope', selected: ['fx-board'] })
		).rejects.toMatchObject({ code: 'not_found' });
	});
});

describe('Ausführen', () => {
	it('falsches Passwort → 422, Modus „off“ → 503', async () => {
		const src = await inspectSource(admin, { url: `${OWNER}/${REPO}` });
		const preview = await previewInstall(admin, {
			sourceToken: src.token,
			selected: ['fx-people']
		});
		await expect(
			confirmInstall(admin, { token: preview.token, password: 'falsch-falsch' })
		).rejects.toMatchObject({ code: 'validation_failed' });
		await expect(
			confirmInstall(admin, { token: preview.token, password: PW })
		).rejects.toMatchObject({ code: 'unavailable' });
	});

	it('Modus „copy“: Dateien ins Modulverzeichnis, Wunschzustand, Verlauf und Audit', async () => {
		process.env.ATRIUM_MODULE_INSTALL = 'copy';
		process.env.ATRIUM_MODULES_DIR = target;
		resetEnvForTests();
		try {
			const src = await inspectSource(admin, { url: `${OWNER}/${REPO}` });
			const preview = await previewInstall(admin, {
				sourceToken: src.token,
				selected: ['fx-consumer', 'fx-people']
			});
			expect(preview.status.available).toBe(true);
			const result = await confirmInstall(admin, { token: preview.token, password: PW });
			expect(result.installed.map((i) => i.id)).toEqual(['fx-board', 'fx-consumer', 'fx-people']);
			expect(result.restartRequired).toBe(true);
			expect(existsSync(join(target, 'fx-board', 'migrations', '0002_events.sql'))).toBe(true);
			expect(readFileSync(join(target, 'fx-consumer', 'atrium-module.json'), 'utf8')).toContain(
				'"fx-consumer"'
			);

			const rows = await getDb().select().from(schema.moduleInstall);
			expect(rows.map((r) => [r.id, r.sourceType, r.commit]).sort()).toEqual([
				['fx-board', 'github', SHA],
				['fx-consumer', 'github', SHA],
				['fx-people', 'github', SHA]
			]);
			const events = await listInstallEvents(admin);
			expect(
				events
					.filter((e) => e.status === 'done')
					.map((e) => e.moduleId)
					.sort()
			).toEqual(['fx-board', 'fx-consumer', 'fx-people']);
			const audit = await listAudit({ limit: 50 });
			expect(JSON.stringify(audit)).toContain('core.module.installed');

			// Plan ist verbraucht
			await expect(
				confirmInstall(admin, { token: preview.token, password: PW })
			).rejects.toMatchObject({ code: 'not_found' });
			// Gleicher Stand erneut → „unverändert“, gesperrt
			const again = await previewInstall(admin, {
				sourceToken: (await inspectSource(admin, { url: `${OWNER}/${REPO}` })).token,
				selected: ['fx-people']
			});
			expect(again.entries[0]!.action).toBe('unchanged');
			expect(again.blockers.join(' ')).toMatch(/bereits in genau diesem Stand/);
		} finally {
			delete process.env.ATRIUM_MODULE_INSTALL;
			delete process.env.ATRIUM_MODULES_DIR;
			resetEnvForTests();
		}
	});
});

describe('Sperren', () => {
	it('veränderte, bereits angewendete Migration sperrt die Aktualisierung', async () => {
		registerModule(boardModule);
		await syncModules();
		admin = await adminContext(ADMIN, PW);
		await enableModule(admin, 'fx-board');
		zipball = repoZip({
			'fx-board/migrations/0001_init.sql': 'CREATE TABLE notes (id text PRIMARY KEY);'
		});
		const src = await inspectSource(admin, { url: `${OWNER}/${REPO}` });
		const preview = await previewInstall(admin, { sourceToken: src.token, selected: ['fx-board'] });
		expect(preview.entries[0]!.installedVersion).toBe('1.2.0');
		expect(preview.blockers.join(' ')).toMatch(/Migration 0001_init wurde verändert/);
	});

	it('erlaubte Quellen: fremdes Repository und ZIP → 403', async () => {
		await setSetting(admin, 'core.modules.allowedSources', 'andere/*');
		try {
			await expect(inspectSource(admin, { url: `${OWNER}/${REPO}` })).rejects.toMatchObject({
				code: 'forbidden'
			});
			await expect(
				inspectSource(admin, { zip: repoZip(), fileName: 'x.zip' })
			).rejects.toMatchObject({ code: 'forbidden' });
			await setSetting(admin, 'core.modules.allowedSources', `${OWNER}/*`);
			await expect(inspectSource(admin, { url: `${OWNER}/${REPO}` })).resolves.toBeTruthy();
		} finally {
			await setSetting(admin, 'core.modules.allowedSources', '');
		}
	});
});
