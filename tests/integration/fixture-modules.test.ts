/**
 * Core gegen die Fixture-Module (Kalypzo Atrium, Phase 4): Abhängigkeiten und Dienste, Personenquelle für Freigaben,
 * gelöschte Personen, Einbetten, Dashboard-Arten, Suche, Job, Datensicherungs-Hooks und gelöschte Konten – ohne
 * die Fachmodule. Fixtures: `tests/fixtures/modules/fx-*`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
	adminContext,
	adminOnlyRestoreScopes,
	apiCall,
	collectDashboardFeed,
	contextForUser,
	createApiKey,
	createRole,
	createUser,
	deleteUser,
	describeEmbeds,
	disableModule,
	enableModule,
	registerCoreApi,
	registerModule,
	runJobNow,
	searchEmbeds,
	searchEverything,
	syncModules,
	useTestDatabase
} from '$testing';
import {
	core,
	describePrincipals,
	principalKeysFor,
	rowsOf,
	searchPrincipals,
	validatePrincipals
} from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';
import boardModule, { ASSETS } from '../fixtures/modules/fx-board/module';
import peopleModule from '../fixtures/modules/fx-people/module';
import consumerModule from '../fixtures/modules/fx-consumer/module';

const ADMIN = 'fixture-admin@example.test';
const PW = 'correct-horse-battery';
let close: () => Promise<void>;
let admin: RequestContext;
let adminKey = '';
let reader: RequestContext;
let readerId = '';
let readerKey = '';
let teamId = '';
let personId = '';
let noteId = '';

const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;
const ok = <T>(r: { status: number; body: { data?: T } }, status = 200): T => {
	expect(r.status, JSON.stringify(r.body)).toBe(status);
	return r.body.data as T;
};
const hookLog = () =>
	core.database
		.forModule('fx-board')
		.transaction((tx) => rowsOf(tx, sql`SELECT kind, ref FROM hook_log ORDER BY id`));

beforeAll(async () => {
	close = (await useTestDatabase()).close;
	registerCoreApi();
	registerModule(peopleModule);
	registerModule(boardModule);
	registerModule(consumerModule);
	await syncModules();
	admin = await adminContext(ADMIN, PW);
	await enableModule(admin, 'fx-people');
	await enableModule(admin, 'fx-board');
	await enableModule(admin, 'fx-consumer');
	admin = await adminContext(ADMIN, PW);
	adminKey = (
		await createApiKey(admin, {
			name: 'Admin',
			scopes: [
				'fx-people.person.edit',
				'fx-board.note.create',
				'fx-board.note.view',
				'fx-consumer.stats.view'
			]
		})
	).key;
	const roleId = await createRole(admin, {
		name: 'Leser*in',
		permissions: ['fx-board.note.view', 'core.api.manage']
	});
	readerId = await createUser(admin, {
		name: 'Lea Leserin',
		email: 'lea@example.test',
		password: PW,
		roleIds: [roleId]
	});
	reader = await ctxOf(readerId);
	readerKey = (await createApiKey(reader, { name: 'Lea', scopes: ['fx-board.note.view'] })).key;
});
afterAll(async () => close());

describe('Abhängigkeiten und Dienste', () => {
	it('harte Abhängigkeit: Dienst über core.modules.use, optionale erkannt', async () => {
		const stats = ok<{ notes: number; peopleActive: boolean }>(
			await apiCall(adminKey, 'GET', '/modules/fx-consumer/stats')
		);
		expect(stats).toEqual({ notes: 0, peopleActive: true });
	});

	it('fx-board lässt sich nicht deaktivieren, solange fx-consumer aktiv ist', async () => {
		await expect(disableModule(admin, 'fx-board')).rejects.toMatchObject({ code: 'conflict' });
	});

	it('eingebettete Dateien (?raw, JSON) sind im Modul verfügbar', () => {
		expect(ASSETS).toEqual({ hint: 'Hinweis aus einer eingebetteten Datei', color: '#2563eb' });
	});
});

describe('Personenquelle (principals)', () => {
	beforeAll(async () => {
		teamId = ok<{ id: string }>(
			await apiCall(adminKey, 'POST', '/modules/fx-people/teams', { name: 'Füchse' }),
			201
		).id;
		personId = ok<{ id: string }>(
			await apiCall(adminKey, 'POST', '/modules/fx-people/people', {
				name: 'Lea Kind',
				userId: readerId,
				teamIds: [teamId]
			}),
			201
		).id;
		noteId = ok<{ id: string }>(
			await apiCall(adminKey, 'POST', '/modules/fx-board/notes', {
				title: 'Zeltlager packen',
				dueOn: '2026-10-29'
			}),
			201
		).id;
	});

	it('core.modules.principalSource nennt das Fixture', () => {
		expect(core.modules.principalSource()).toEqual({
			id: 'fx-people',
			memberViewPermission: 'fx-people.person.view'
		});
	});

	it('Schlüssel der Person enthalten Person und Team', async () => {
		const keys = await principalKeysFor(await ctxOf(readerId), 'fx-board');
		expect(keys).toEqual(
			expect.arrayContaining([`member:${personId}`, `group:${teamId}`, `user:${readerId}`])
		);
	});

	it('Freigabe an das Team macht den Eintrag sichtbar', async () => {
		expect(ok<unknown[]>(await apiCall(readerKey, 'GET', '/modules/fx-board/notes'))).toEqual([]);
		ok(
			await apiCall(adminKey, 'PUT', `/modules/fx-board/notes/${noteId}/shares`, {
				shares: [
					{ type: 'group', id: teamId, level: 'read' },
					{ type: 'member', id: personId, level: 'read' }
				]
			})
		);
		expect(
			ok<{ id: string }[]>(await apiCall(readerKey, 'GET', '/modules/fx-board/notes'))
		).toEqual([{ id: noteId, title: 'Zeltlager packen' }]);
	});

	it('Personen nur mit memberViewPermission in Suche und Anzeige', async () => {
		const opts = { everyoneLabel: 'Alle' };
		const withoutRight = await searchPrincipals(reader, 'fx-board', 'Lea', opts);
		expect(withoutRight.some((p) => p.type === 'member')).toBe(false);
		const withRight = await searchPrincipals(admin, 'fx-board', 'Lea', opts);
		expect(withRight).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'member', id: personId })])
		);
		const shown = await describePrincipals(
			reader,
			'fx-board',
			[{ type: 'member', id: personId }],
			opts
		);
		expect(shown[0]?.name).toBe('Mitglied');
		const groups = await searchPrincipals(reader, 'fx-board', 'Füch', opts);
		expect(groups).toEqual(
			expect.arrayContaining([expect.objectContaining({ type: 'group', id: teamId })])
		);
	});

	it('unbekannte Person wird abgelehnt (422)', async () => {
		await expect(
			validatePrincipals(admin, 'fx-board', [{ type: 'member', id: crypto.randomUUID() }])
		).rejects.toMatchObject({ code: 'validation_failed' });
	});

	it('nur die Personenquelle darf gelöschte Personen melden', async () => {
		await expect(
			core.modules.memberDeleted('fx-board', { memberIds: ['x'], reason: 'deleted' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});
});

describe('Hooks der Module', () => {
	it('Einbetten: Suche und Auflösung je Betrachter*in', async () => {
		const hits = await searchEmbeds(reader, 'Zelt');
		expect(hits).toEqual([
			expect.objectContaining({ module: 'fx-board', kind: 'note', refId: noteId })
		]);
		const [info] = await describeEmbeds(reader, [
			{ module: 'fx-board', kind: 'note', refId: noteId }
		]);
		expect(info).toMatchObject({ available: true, title: 'Zeltlager packen' });
	});

	it('Dashboard: eigene Art erscheint mit Legende', async () => {
		const feed = await collectDashboardFeed(reader, { today: '2026-10-28' });
		expect(feed.agenda).toEqual([
			expect.objectContaining({ id: noteId, kind: 'fx-pin', moduleId: 'fx-board' })
		]);
		expect(feed.kinds.map((k) => k.key)).toContain('fx-pin');
	});

	it('Suche findet sichtbare Einträge', async () => {
		const res = await searchEverything(reader, 'Zeltlager');
		expect(res.groups.find((g) => g.source === 'fx-board')?.hits[0]?.id).toBe(noteId);
	});

	it('Job läuft über runJobNow', async () => {
		await runJobNow(admin, 'fx-board.tick');
		expect(await hookLog()).toEqual(expect.arrayContaining([{ kind: 'job', ref: 'tick' }]));
	});

	it('Datensicherung: Bereich nur für Administrator*innen mit Grund des Moduls', () => {
		expect(adminOnlyRestoreScopes().get('fx-board')).toMatch(/Fixture Pinnwand.*Testgrund/);
		expect(adminOnlyRestoreScopes().has('fx-people')).toBe(false);
	});

	it('gelöschte Person → onMemberDeleted der anderen Module', async () => {
		ok(await apiCall(adminKey, 'DELETE', `/modules/fx-people/people/${personId}`));
		expect(await hookLog()).toEqual(
			expect.arrayContaining([{ kind: 'member-deleted', ref: personId }])
		);
	});

	it('gelöschtes Konto → onUserDeleted bereinigt Freigaben', async () => {
		ok(
			await apiCall(adminKey, 'PUT', `/modules/fx-board/notes/${noteId}/shares`, {
				shares: [{ type: 'user', id: readerId, level: 'read' }]
			})
		);
		await deleteUser(admin, readerId);
		const rows = await core.database
			.forModule('fx-board')
			.transaction((tx) =>
				rowsOf(tx, sql`SELECT principal_id FROM note_shares WHERE principal_type = 'user'`)
			);
		expect(rows).toEqual([]);
	});
});
