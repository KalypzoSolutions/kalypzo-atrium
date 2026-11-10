/**
 * Update-Logik für Module aus GitHub (Kalypzo Atrium, Updates 2.0) mit den Fixture-Modulen und nachgebautem GitHub:
 * Vergleich über Inhalt statt Commit, ein Download je Commit, Kanäle Release/Branch, Änderungsnotizen, Ignorieren,
 * Benachrichtigung nur bei Neuem, Update-Vorschau aus dem Prüfstand, Job, Übersichtskachel, Rücksprung-Zustand.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
	adminContext,
	getDb,
	registerCoreApi,
	registerModule,
	resetEnvForTests,
	runJobNow,
	schema,
	settleMails,
	syncModules,
	useTestDatabase
} from '$testing';
import { setMailTransportForTests, type MailTransport } from '$lib/server/core/mail';
import { setGithubFetchForTests } from '$lib/server/core/modules/install/github';
import {
	checkUpdates,
	ignoreUpdate,
	listUpdateChecks,
	runUpdateCheck,
	setUpdateChannel
} from '$lib/server/core/modules/install/updates';
import { rollbackInstall, rollbackPreview } from '$lib/server/core/modules/install/manage';
import {
	previewUpdates,
	resetInstallSessionsForTests
} from '$lib/server/core/modules/install/service';
import { reconcileInstallEvents } from '$lib/server/core/modules/install/supervisor-link';
import {
	adminOverviewStats,
	invalidateAdminOverviewCache
} from '$lib/server/core/admin/overview-stats';
import type { RequestContext } from '$lib/sdk/types';
import boardModule from '../fixtures/modules/fx-board/module';
import peopleModule from '../fixtures/modules/fx-people/module';
import { filesOf, makeZip } from '../helpers/module-zip';

const FIXTURES = join(__dirname, '..', 'fixtures', 'modules');
const PW = 'correct-horse-battery';
const OLD = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const TAG = '3'.repeat(40);
const TAG2 = '4'.repeat(40);
let close: () => Promise<void>;
let admin: RequestContext;

type Sent = Parameters<MailTransport['sendMail']>[0];
let mails: Sent[] = [];
/** Abgerufene Archive (Pfad) – je Commit soll nur einmal geladen werden */
let downloads: string[] = [];
let tags: { name: string; commit: { sha: string } }[] = [];
const zips = new Map<string, Uint8Array>();

function repoZip(sha: string, patch: Record<string, string> = {}): Uint8Array {
	return makeZip({ ...filesOf(FIXTURES), ...patch }, `org-mods-${sha.slice(0, 7)}/`);
}

/** Inhaltshash eines Fixture-Moduls laut Discover (wie bei der Installation) */
async function hashOf(id: string, sha: string): Promise<string> {
	const { readModuleArchive } = await import('$lib/server/core/modules/install/archive');
	const { discoverModules } = await import('$lib/server/core/modules/install/discover');
	const files = readModuleArchive(zips.get(sha)!);
	return discoverModules(files, '').modules.find((m) => m.id === id)!.contentHash;
}

async function installRow(
	values: Partial<typeof schema.moduleInstall.$inferInsert> & { id: string }
) {
	await getDb()
		.insert(schema.moduleInstall)
		.values({
			version: '1.0.0',
			sourceType: 'github',
			source: { owner: 'org', repo: 'mods', path: values.id, ref: 'main' },
			commit: OLD,
			contentHash: 'sha256-alt',
			...values
		})
		.onConflictDoUpdate({
			target: schema.moduleInstall.id,
			set: {
				version: values.version ?? '1.0.0',
				commit: values.commit ?? OLD,
				contentHash: values.contentHash ?? 'sha256-alt',
				channel: values.channel ?? 'branch',
				ignoredUpdate: null
			}
		});
}

/** Nachgebautes GitHub (API + codeload) für die Archive in `zips` */
async function githubFake(url: string): Promise<Response> {
	const u = new URL(url);
	if (u.hostname === 'codeload.github.com') {
		const sha = u.pathname.split('/').pop()!;
		downloads.push(sha);
		return new Response(zips.get(sha) as BodyInit);
	}
	if (u.pathname === '/repos/org/mods') {
		return new Response(JSON.stringify({ default_branch: 'main' }));
	}
	if (u.pathname === '/repos/org/mods/commits/main') {
		return new Response(JSON.stringify({ sha: HEAD }));
	}
	if (u.pathname === '/repos/org/mods/tags') {
		return new Response(JSON.stringify(u.searchParams.get('page') === '1' ? tags : []));
	}
	if (u.pathname === '/repos/org/mods/commits') {
		return new Response(
			JSON.stringify([
				{ sha: HEAD, commit: { message: 'Board: neue Spalte\n\nDetails' } },
				{ sha: OLD, commit: { message: 'alt' } }
			])
		);
	}
	const zip = /^\/repos\/org\/mods\/zipball\/([0-9a-f]{40})$/.exec(u.pathname);
	if (zip && zips.has(zip[1]!)) {
		return new Response(null, {
			status: 302,
			headers: { location: `https://codeload.github.com/org/mods/legacy.zip/${zip[1]}` }
		});
	}
	return new Response('{}', { status: 404 });
}

beforeAll(async () => {
	close = (await useTestDatabase()).close;
	registerCoreApi();
	registerModule(peopleModule);
	registerModule(boardModule);
	await syncModules();
	admin = await adminContext('updates@example.test', PW);
	setMailTransportForTests({ sendMail: async (m) => void mails.push(m) });
	zips.set(HEAD, repoZip(HEAD));
	zips.set(
		TAG,
		repoZip(TAG, {
			'fx-people/CHANGELOG.md':
				'# Änderungen\n\n## 1.0.0\n- Personen als Quelle\n\n## 0.9.0\n- Alt\n'
		})
	);
	zips.set(
		TAG2,
		repoZip(TAG2, {
			'fx-people/atrium-module.json': JSON.stringify({
				...JSON.parse(
					new TextDecoder().decode(filesOf(join(FIXTURES, 'fx-people'))['atrium-module.json'])
				),
				version: '1.1.0'
			})
		})
	);
	setGithubFetchForTests(githubFake);
});

beforeEach(() => {
	downloads = [];
	mails = [];
	tags = [];
	resetInstallSessionsForTests();
});

afterAll(async () => {
	setGithubFetchForTests(null);
	setMailTransportForTests(undefined);
	for (const k of ['ATRIUM_MODULE_INSTALL', 'ATRIUM_DATA_DIR', 'ATRIUM_GENERATION']) {
		delete process.env[k];
	}
	resetEnvForTests();
	resetInstallSessionsForTests();
	await close();
});

describe('Prüfen (Branch-Kanal)', () => {
	it('gleicher Inhalt trotz neuem Commit → aktuell; ein Download für alle Module des Repos', async () => {
		await installRow({ id: 'fx-people', contentHash: await hashOf('fx-people', HEAD) });
		await installRow({ id: 'fx-board', version: '0.9.0' });
		const list = await checkUpdates(admin);
		expect(list.find((u) => u.id === 'fx-people')).toMatchObject({
			status: 'current',
			latestCommit: HEAD,
			channel: 'branch'
		});
		const board = list.find((u) => u.id === 'fx-board')!;
		expect(board).toMatchObject({ status: 'update', latestVersion: '1.2.0', latestRef: 'main' });
		// Keine CHANGELOG.md → Commits des Modulpfads bis zum installierten Commit
		expect(board.commits).toEqual([{ sha: HEAD, message: 'Board: neue Spalte' }]);
		expect(downloads).toEqual([HEAD]);
	});

	it('gleiche Version, anderer Inhalt → „geändert“; installierter Commit = Kopf → ohne Download aktuell', async () => {
		await installRow({ id: 'fx-board', version: '1.2.0' });
		expect((await checkUpdates(admin)).find((u) => u.id === 'fx-board')?.status).toBe('changed');
		await installRow({ id: 'fx-board', version: '1.2.0', commit: HEAD });
		await installRow({
			id: 'fx-people',
			commit: HEAD,
			contentHash: await hashOf('fx-people', HEAD)
		});
		downloads = [];
		const list = await checkUpdates(admin);
		expect(list.find((u) => u.id === 'fx-board')?.status).toBe('current');
		expect(downloads).toEqual([]);
	});

	it('der Prüfstand bleibt gespeichert (ohne Netz lesbar)', async () => {
		await installRow({ id: 'fx-board', version: '0.9.0' });
		await runUpdateCheck();
		setGithubFetchForTests(async () => {
			throw new Error('kein Netz erwartet');
		});
		try {
			const list = await listUpdateChecks(admin);
			expect(list.find((u) => u.id === 'fx-board')?.status).toBe('update');
			expect(list.find((u) => u.id === 'fx-board')?.checkedAt).toBeTruthy();
		} finally {
			setGithubFetchForTests(githubFake);
		}
	});
});

describe('Release-Kanal', () => {
	it('nimmt den höchsten Modul-Tag, liest Änderungsnotizen aus CHANGELOG.md', async () => {
		tags = [
			{ name: 'v0.1.0', commit: { sha: OLD } },
			{ name: 'fx-people@1.0.0', commit: { sha: TAG } },
			{ name: 'fx-people@1.1.0-beta.1', commit: { sha: TAG2 } }
		];
		await installRow({ id: 'fx-people', version: '0.9.0', channel: 'release' });
		const u = (await checkUpdates(admin)).find((x) => x.id === 'fx-people')!;
		expect(u).toMatchObject({ status: 'update', latestRef: 'fx-people@1.0.0', latestCommit: TAG });
		expect(u.changelog).toEqual([{ version: '1.0.0', notes: '- Personen als Quelle' }]);
		expect(u.latestUrl).toBe(`https://github.com/org/mods/tree/${TAG}/fx-people`);
	});

	it('ohne passende Tags → Fehler mit Hinweis auf den Branch-Kanal', async () => {
		tags = [{ name: 'main-build', commit: { sha: OLD } }];
		await installRow({ id: 'fx-people', version: '0.9.0', channel: 'release' });
		const u = (await checkUpdates(admin)).find((x) => x.id === 'fx-people')!;
		expect(u.status).toBe('error');
		expect(u.message).toContain('Branch');
	});

	it('Kanal umschalten: gespeichert, alter Prüfstand verworfen, Audit', async () => {
		await installRow({ id: 'fx-people', version: '0.9.0', channel: 'release' });
		await setUpdateChannel(admin, 'fx-people', 'branch');
		const [row] = await getDb()
			.select()
			.from(schema.moduleInstall)
			.where(eq(schema.moduleInstall.id, 'fx-people'));
		expect(row?.channel).toBe('branch');
		const check = await getDb()
			.select()
			.from(schema.moduleUpdateCheck)
			.where(eq(schema.moduleUpdateCheck.id, 'fx-people'));
		expect(check).toHaveLength(0);
		await expect(setUpdateChannel(admin, 'fx-unbekannt', 'branch')).rejects.toMatchObject({
			code: 'not_found'
		});
	});
});

describe('Ignorieren und Benachrichtigen', () => {
	it('meldet ein Update genau einmal; ignoriert → kein Zähler, neuere Version erscheint wieder', async () => {
		await getDb().delete(schema.moduleUpdateCheck);
		await installRow({
			id: 'fx-people',
			commit: HEAD,
			contentHash: await hashOf('fx-people', HEAD)
		});
		await installRow({ id: 'fx-board', version: '0.9.0' });
		const first = await runUpdateCheck();
		expect(first.updates).toEqual(['fx-board']);
		expect(first.notified).toBeGreaterThan(0);
		await settleMails();
		expect(mails.some((m) => String(m.subject).includes('Modul-Update'))).toBe(true);
		mails = [];
		const second = await runUpdateCheck();
		expect(second.notified).toBe(0);

		await ignoreUpdate(admin, 'fx-board', true);
		expect((await listUpdateChecks(admin)).find((u) => u.id === 'fx-board')?.status).toBe(
			'ignored'
		);
		invalidateAdminOverviewCache();
		expect((await adminOverviewStats(admin)).modules?.updates).toBe(0);
		await ignoreUpdate(admin, 'fx-board', false);
		invalidateAdminOverviewCache();
		expect((await adminOverviewStats(admin)).modules?.updates).toBe(1);
	});

	it('ohne Prüfstand lässt sich nichts ignorieren', async () => {
		await getDb().delete(schema.moduleUpdateCheck);
		await expect(ignoreUpdate(admin, 'fx-board', true)).rejects.toMatchObject({ code: 'conflict' });
	});

	it('der tägliche Job überspringt, solange Installieren ausgeschaltet ist', async () => {
		const info = await runJobNow(admin, 'core.module-updates');
		expect(info.lastStatus).toBe('ok');
		expect(info.lastMessage).toContain('Übersprungen');
	});
});

describe('Update-Vorschau aus dem Prüfstand', () => {
	it('baut den Plan aus dem gespeicherten Commit (ohne Quelle eingeben)', async () => {
		await installRow({
			id: 'fx-people',
			commit: HEAD,
			contentHash: await hashOf('fx-people', HEAD)
		});
		await installRow({ id: 'fx-board', version: '0.9.0' });
		await runUpdateCheck();
		const preview = await previewUpdates(admin, { ids: ['fx-board'] });
		const entry = preview.entries.find((e) => e.id === 'fx-board')!;
		// Geladen ist im Test schon fx-board 1.2.0 (Fixture) – die Analyse vergleicht mit dem geladenen Stand
		expect(entry).toMatchObject({ action: 'reinstall', version: '1.2.0', commit: HEAD });
		expect(preview.token).toBeTruthy();
	});

	it('ohne Prüfstand → Konflikt mit Hinweis', async () => {
		await getDb().delete(schema.moduleUpdateCheck);
		await expect(previewUpdates(admin, { ids: ['fx-board'] })).rejects.toMatchObject({
			code: 'conflict'
		});
	});
});

describe('Rücksprung zur vorigen Version', () => {
	let data = '';

	beforeAll(() => {
		data = mkdtempSync(join(tmpdir(), 'atrium-rollback-'));
		const gen = (id: string, modules: Record<string, unknown>, createdAt: string) => {
			mkdirSync(join(data, 'gen', id, 'build'), { recursive: true });
			writeFileSync(join(data, 'gen', id, 'build', 'index.js'), '');
			writeFileSync(
				join(data, 'gen', id, 'atrium-modules.lock.json'),
				JSON.stringify({ lockVersion: 1, core: '2.0.0', modules })
			);
			writeFileSync(join(data, 'gen', id, 'BUILD_INFO.json'), JSON.stringify({ createdAt }));
		};
		const entry = (version: string, hash: string) => ({
			version,
			sourceType: 'github',
			source: { owner: 'org', repo: 'mods', path: 'fx-board', ref: 'main' },
			commit: OLD,
			contentHash: hash
		});
		gen('gold', { 'fx-board': entry('0.9.0', 'sha256-alt') }, '2026-11-01T00:00:00Z');
		gen(
			'gnew',
			{ 'fx-board': entry('1.0.0', 'sha256-neu'), 'fx-people': entry('1.0.0', 'sha256-p') },
			'2026-11-02T00:00:00Z'
		);
		writeFileSync(join(data, 'state.json'), JSON.stringify({ current: 'gnew', previous: 'gold' }));
		process.env.ATRIUM_DATA_DIR = data;
		process.env.ATRIUM_GENERATION = 'gnew';
		process.env.ATRIUM_MODULE_INSTALL = 'supervisor';
		resetEnvForTests();
	});

	afterAll(() => {
		delete process.env.ATRIUM_MODULE_INSTALL;
		delete process.env.ATRIUM_GENERATION;
		delete process.env.ATRIUM_DATA_DIR;
		resetEnvForTests();
		rmSync(data, { recursive: true, force: true });
	});

	it('Vorschau listet die Unterschiede der Generationen', async () => {
		const info = await rollbackPreview(admin);
		expect(info).toMatchObject({ target: 'gold', createdAt: '2026-11-01T00:00:00Z' });
		expect(info!.changes).toEqual([
			{ id: 'fx-board', from: '1.0.0', to: '0.9.0', migrationsAfter: false },
			{ id: 'fx-people', from: '1.0.0', to: null, migrationsAfter: false }
		]);
	});

	it('ohne Supervisor-Verbindung kein Rücksprung; nach Ergebnis „done“ folgt der Wunschzustand', async () => {
		await expect(rollbackInstall(admin, { password: PW })).rejects.toMatchObject({
			code: 'unavailable'
		});
		// Wie nach einem Rücksprung: Ereignisse „angefordert“ + Ergebnis des Supervisors
		const planId = 'rollbacktest01';
		await installRow({ id: 'fx-board', version: '1.0.0', contentHash: 'sha256-neu' });
		await installRow({ id: 'fx-people', version: '1.0.0', contentHash: 'sha256-p' });
		await getDb()
			.insert(schema.moduleInstallEvent)
			.values([
				{
					id: crypto.randomUUID(),
					moduleId: 'fx-board',
					action: 'rollback',
					fromVersion: '1.0.0',
					toVersion: '0.9.0',
					sourceType: 'github',
					source: { owner: 'org', repo: 'mods', path: 'fx-board', ref: 'main' },
					commit: OLD,
					contentHash: 'sha256-alt',
					planId,
					status: 'requested'
				},
				{
					id: crypto.randomUUID(),
					moduleId: 'fx-people',
					action: 'rollback',
					fromVersion: '1.0.0',
					toVersion: null,
					planId,
					status: 'requested'
				}
			]);
		mkdirSync(join(data, 'results'), { recursive: true });
		writeFileSync(
			join(data, 'results', `${planId}.json`),
			JSON.stringify({
				planId,
				status: 'done',
				generation: 'gold',
				message: 'Zurück',
				finishedAt: ''
			})
		);
		expect(await reconcileInstallEvents()).toBe(2);
		const rows = await getDb().select().from(schema.moduleInstall);
		expect(rows.find((r) => r.id === 'fx-board')).toMatchObject({
			version: '0.9.0',
			contentHash: 'sha256-alt'
		});
		expect(rows.find((r) => r.id === 'fx-people')).toBeUndefined();
	});
});
