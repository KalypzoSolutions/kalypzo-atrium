/**
 * Fixture-Modul „Pinnwand“ (nur Tests des Core): Einträge mit Freigaben an Principals, dazu alle Hooks, die der Core
 * für Module anbietet – Einbetten, Dashboard (eigene Art `fx-pin`), Suche, Benachrichtigung, Job, Datensicherung
 * (`adminOnlyRestore`, `afterRestoreJobs`), Reset, Konto/Person gelöscht, Dienst für abhängige Module – sowie eine
 * Oberfläche mit internen, öffentlichen und einbettbaren Seiten, `?raw`-Asset und JSON-Import.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
	core,
	createShareAccess,
	defineEndpoint,
	defineModule,
	inList,
	manifestFromPackage,
	moduleDb,
	principalKeysFor,
	rowsOf,
	validatePrincipals,
	type RequestContext
} from '$lib/sdk/server';
import type { BoardService } from './contract';
import pkg from './atrium-module.json';
import colors from './data/colors.json';
import hint from './assets/hint.txt?raw';
import m0001 from './migrations/0001_init.sql?raw';
import m0002 from './migrations/0002_events.sql?raw';

/** Spaltenwert als Text (leer statt null) */
const text = (v: unknown): string => String(v ?? '');

export const MODULE_ID = 'fx-board';
export const PERM = {
	view: 'fx-board.note.view',
	create: 'fx-board.note.create',
	viewAll: 'fx-board.note.view-all',
	editAll: 'fx-board.note.edit-all'
} as const;
export const NOTIFY_SHARED = 'note-shared';
/** Für Tests: Inhalt der eingebetteten Dateien */
export const ASSETS = { hint: hint.trim(), color: colors.default };

const db = () => moduleDb(MODULE_ID);

const access = createShareAccess({
	table: 'notes',
	shareTable: 'note_shares',
	fk: 'note_id',
	perms: { viewAll: PERM.viewAll, editAll: PERM.editAll },
	notFoundText: 'Eintrag nicht gefunden',
	forbiddenText: 'Keine Berechtigung für diesen Eintrag'
});

/** Sichtbare Einträge (eigene, freigegebene oder alle mit `view-all`) */
async function visibleNotes(ctx: RequestContext, search = '', ids?: readonly string[]) {
	const keys = await principalKeysFor(ctx, MODULE_ID);
	return db().transaction((tx) =>
		rowsOf(
			tx,
			sql`SELECT n.id, n.title, to_char(n.due_on, 'YYYY-MM-DD') AS due_on, n.owner_id FROM notes n
			    WHERE ${access.visibleFilter(ctx, keys, 'n')}
			      AND n.title ILIKE ${`%${search.replace(/[%_\\]/g, '\\$&')}%`}
			      ${ids ? sql`AND n.id IN (${inList([...ids])})` : sql``}
			    ORDER BY n.title`
		)
	);
}

const shareInput = z.strictObject({
	shares: z
		.array(
			z.strictObject({
				type: z.enum(['everyone', 'group', 'role', 'user', 'member']),
				id: z.string().min(1),
				level: z.enum(['read', 'edit'])
			})
		)
		.max(50)
});

export const boardService = {
	async countNotes() {
		const [r] = await db().transaction((tx) => rowsOf(tx, sql`SELECT count(*) AS n FROM notes`));
		return Number(r?.n ?? 0);
	}
} satisfies BoardService;

export default defineModule({
	package: pkg,
	manifest: {
		...manifestFromPackage(pkg),
		permissions: [PERM.view, PERM.create, PERM.viewAll, PERM.editAll],
		permissionDescriptions: {
			[PERM.view]: 'Pinnwand nutzen',
			[PERM.create]: 'Einträge anlegen',
			[PERM.viewAll]: 'Alle Einträge sehen',
			[PERM.editAll]: 'Alle Einträge bearbeiten'
		},
		navigation: [
			{ label: 'Pinnwand', icon: 'kanban', path: '/modules/fx-board', permission: PERM.view }
		]
	},
	migrations: [
		{ name: '0001_init', sql: m0001 },
		{ name: '0002_events', sql: m0002 }
	],
	provides: boardService,
	endpoints: [
		defineEndpoint({
			method: 'POST',
			path: '/notes',
			summary: 'Eintrag anlegen',
			permission: PERM.create,
			body: z.strictObject({
				title: z.string().trim().min(1).max(120),
				dueOn: z.iso.date().nullable().default(null)
			}),
			handler: async ({ ctx, body }) => {
				const id = crypto.randomUUID();
				await db().transaction((tx) =>
					tx.execute(
						sql`INSERT INTO notes (id, title, due_on, owner_id) VALUES (${id}, ${body.title}, ${body.dueOn}, ${ctx.userId})`
					)
				);
				return { id };
			}
		}),
		defineEndpoint({
			method: 'GET',
			path: '/notes',
			summary: 'Sichtbare Einträge',
			permission: PERM.view,
			handler: async ({ ctx }) =>
				(await visibleNotes(ctx)).map((r) => ({ id: text(r.id), title: text(r.title) }))
		}),
		defineEndpoint({
			method: 'PUT',
			path: '/notes/:id/shares',
			summary: 'Freigaben ersetzen',
			permission: PERM.view,
			params: z.object({ id: z.string().min(1) }),
			body: shareInput,
			handler: async ({ ctx, params, body }) => {
				await validatePrincipals(ctx, MODULE_ID, body.shares);
				const keys = await principalKeysFor(ctx, MODULE_ID);
				await db().transaction(async (tx) => {
					await access.requireAccess(tx, ctx, params.id, keys, 'edit');
					await access.replaceShares(tx, ctx, params.id, body.shares);
				});
				return { id: params.id, shares: body.shares.length };
			}
		})
	],
	embeds: [
		{
			kind: 'note',
			label: 'Pinnwand-Eintrag',
			icon: 'kanban',
			permission: PERM.view,
			search: async (ctx, query, limit) =>
				(await visibleNotes(ctx, query))
					.slice(0, limit)
					.map((r) => ({ refId: text(r.id), title: text(r.title) })),
			describe: async (ctx, ids) =>
				new Map(
					(await visibleNotes(ctx, '', ids)).map((r) => [
						text(r.id),
						{ title: text(r.title), canEdit: false, path: text(r.id) }
					])
				)
		}
	],
	dashboard: {
		agendaKinds: [{ key: 'fx-pin', label: 'Pinnwand', style: 'marked' }],
		agenda: {
			permission: PERM.view,
			run: async (ctx, { from, to }) =>
				(await visibleNotes(ctx))
					.filter((r) => r.due_on && text(r.due_on) >= from && text(r.due_on) <= to)
					.map((r) => ({
						id: text(r.id),
						kind: 'fx-pin',
						title: text(r.title),
						date: text(r.due_on),
						href: `/modules/fx-board/${text(r.id)}`
					}))
		}
	},
	search: {
		permission: PERM.view,
		run: async (ctx, query, limit) =>
			(await visibleNotes(ctx, query)).slice(0, limit).map((r) => ({
				id: text(r.id),
				title: text(r.title),
				href: `/modules/fx-board/${text(r.id)}`,
				type: 'Pinnwand'
			}))
	},
	notifications: {
		types: [
			{
				key: NOTIFY_SHARED,
				label: 'Eintrag geteilt',
				description: 'Wenn ein Eintrag mit dir geteilt wird.',
				permission: PERM.view
			}
		]
	},
	jobs: [
		{
			id: 'tick',
			summary: 'Protokolliert einen Lauf',
			schedule: 'hourly',
			run: async () => {
				await db().transaction((tx) =>
					tx.execute(sql`INSERT INTO hook_log (kind, ref) VALUES ('job', 'tick')`)
				);
				return 'ok';
			}
		}
	],
	backup: {
		adminOnlyRestore: 'Testgrund',
		afterRestoreJobs: ['tick']
	},
	resetAreas: [
		{
			id: 'all',
			label: 'Alle Einträge',
			description: 'Einträge, Freigaben und Protokoll',
			tables: ['note_shares', 'notes', 'hook_log'],
			rebuild: true
		}
	],
	onUserDeleted: async (tx, { userId, transferTo }) => {
		await tx.execute(
			sql`DELETE FROM note_shares WHERE principal_type = 'user' AND principal_id = ${userId}`
		);
		await tx.execute(sql`UPDATE notes SET owner_id = ${transferTo} WHERE owner_id = ${userId}`);
	},
	onMemberDeleted: async (tx, { memberIds }) => {
		for (const id of memberIds) {
			await tx.execute(sql`INSERT INTO hook_log (kind, ref) VALUES ('member-deleted', ${id})`);
			await tx.execute(
				sql`DELETE FROM note_shares WHERE principal_type = 'member' AND principal_id = ${id}`
			);
		}
	},
	onEnable: async () => {
		// nur, damit der Hook vorhanden ist (Core ruft ihn nach dem Aktivieren auf)
		void core;
	}
});
