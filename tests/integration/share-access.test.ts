/**
 * SDK-Baustein `createShareAccess` (#35) gegen eine eigene Testtabelle: Zugriffsmatrix
 * Eigentümer*in / Freigabe read / Freigabe edit / view-all / edit-all / System / fremd,
 * öffentliche Sichtbarkeit (`readIf`, wie `galleries`), Listenfilter, `accessForMany`,
 * Freigaben laden/ersetzen und die Bausteine `shareLevelOn`/`loadObjectShares`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb } from '$lib/server/core/database/client';
import {
	createShareAccess,
	loadObjectShares,
	moduleDb,
	rowsOf,
	shareLevelOn,
	type ObjectAccess
} from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';

const MOD = 'sharetest';
const VIEW_ALL = 'sharetest.thing.view-all';
const EDIT_ALL = 'sharetest.thing.edit-all';

const access = createShareAccess({
	table: 'things',
	shareTable: 'thing_shares',
	fk: 'thing_id',
	perms: { viewAll: VIEW_ALL, editAll: EDIT_ALL },
	readIf: { column: 'visibility', equals: 'public' },
	notFoundText: 'Ding nicht gefunden',
	forbiddenText: 'Keine Berechtigung zum Bearbeiten dieses Dings'
});
/** Gleiche Tabelle ohne `readIf` (wie `events`) */
const plain = createShareAccess({
	table: 'things',
	shareTable: 'thing_shares',
	fk: 'thing_id',
	perms: { viewAll: VIEW_ALL, editAll: EDIT_ALL },
	notFoundText: 'Ding nicht gefunden',
	forbiddenText: 'Keine Berechtigung'
});

function ctxOf(userId: string | null, perms: string[] = [], system = false): RequestContext {
	return {
		actor: system
			? { type: 'system', id: 'test', name: 'Test' }
			: { type: 'user', id: userId ?? 'anon', name: userId ?? 'anon' },
		userId,
		permissions: new Set(perms),
		ip: null,
		requestId: 'test'
	};
}

const keysOf = (userId: string) => ['everyone:*', `user:${userId}`];
const db = () => moduleDb(MOD);

const T_PRIVATE = '00000000-0000-4000-8000-000000000001';
const T_PUBLIC = '00000000-0000-4000-8000-000000000002';

beforeAll(async () => {
	await useTestDatabase();
	await getDb().execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "mod_${MOD}"`));
	await db().transaction(async (tx) => {
		await tx.execute(sql`CREATE TABLE things (
			id text PRIMARY KEY, owner_id text NOT NULL, visibility text NOT NULL DEFAULT 'private')`);
		await tx.execute(sql`CREATE TABLE thing_shares (
			thing_id text NOT NULL REFERENCES things(id) ON DELETE CASCADE,
			principal_type text NOT NULL, principal_id text NOT NULL, level text NOT NULL,
			created_by text, created_at timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (thing_id, principal_type, principal_id))`);
		await tx.execute(sql`INSERT INTO things (id, owner_id, visibility) VALUES
			(${T_PRIVATE}, 'owner', 'private'), (${T_PUBLIC}, 'owner', 'public')`);
	});
	await db().transaction((tx) =>
		access.replaceShares(tx, ctxOf('owner'), T_PRIVATE, [
			{ type: 'user', id: 'reader', level: 'read' },
			{ type: 'user', id: 'editor', level: 'edit' }
		])
	);
});

async function resolve(
	a: typeof access,
	ctx: RequestContext,
	id = T_PRIVATE
): Promise<ObjectAccess | null> {
	return db().transaction((tx) => a.resolveAccess(tx, ctx, id, keysOf(ctx.userId ?? '')));
}

describe('createShareAccess – Zugriffsmatrix', () => {
	it('Eigentümer*in → edit, isOwner', async () => {
		expect(await resolve(access, ctxOf('owner'))).toEqual({ level: 'edit', isOwner: true });
	});
	it('Freigabe read → read, Freigabe edit → edit', async () => {
		expect(await resolve(access, ctxOf('reader'))).toEqual({ level: 'read', isOwner: false });
		expect(await resolve(access, ctxOf('editor'))).toEqual({ level: 'edit', isOwner: false });
	});
	it('view-all → read, edit-all und System → edit', async () => {
		expect(await resolve(access, ctxOf('x', [VIEW_ALL]))).toEqual({
			level: 'read',
			isOwner: false
		});
		expect(await resolve(access, ctxOf('x', [EDIT_ALL]))).toEqual({
			level: 'edit',
			isOwner: false
		});
		expect(await resolve(access, ctxOf(null, [], true))).toEqual({
			level: 'edit',
			isOwner: false
		});
	});
	it('fremd → null bzw. 404, unbekannt → null', async () => {
		expect(await resolve(access, ctxOf('stranger'))).toBeNull();
		expect(await resolve(access, ctxOf('owner'), 'gibt-es-nicht')).toBeNull();
		await expect(
			db().transaction((tx) =>
				access.requireAccess(tx, ctxOf('stranger'), T_PRIVATE, keysOf('stranger'))
			)
		).rejects.toMatchObject({ status: 404, message: 'Ding nicht gefunden' });
	});
	it('requireAccess edit mit nur read → 403', async () => {
		await expect(
			db().transaction((tx) =>
				access.requireAccess(tx, ctxOf('reader'), T_PRIVATE, keysOf('reader'), 'edit')
			)
		).rejects.toMatchObject({ status: 403 });
	});
	it('readIf: öffentlich lesbar nur mit readIf-Konfiguration', async () => {
		expect(await resolve(access, ctxOf('stranger'), T_PUBLIC)).toEqual({
			level: 'read',
			isOwner: false
		});
		expect(await resolve(plain, ctxOf('stranger'), T_PUBLIC)).toBeNull();
	});
});

describe('createShareAccess – Listen und Freigaben', () => {
	async function visible(a: typeof access, ctx: RequestContext): Promise<string[]> {
		const rows = await db().transaction((tx) =>
			rowsOf(
				tx,
				sql`SELECT t.id FROM things t WHERE ${a.visibleFilter(ctx, keysOf(ctx.userId ?? ''), 't')}
					ORDER BY t.id`
			)
		);
		return rows.map((r) => String(r.id));
	}

	it('visibleFilter: eigene, freigegebene, öffentliche, alle mit view-all', async () => {
		expect(await visible(access, ctxOf('owner'))).toEqual([T_PRIVATE, T_PUBLIC]);
		expect(await visible(access, ctxOf('reader'))).toEqual([T_PRIVATE, T_PUBLIC]);
		expect(await visible(access, ctxOf('stranger'))).toEqual([T_PUBLIC]);
		expect(await visible(plain, ctxOf('stranger'))).toEqual([]);
		expect(await visible(plain, ctxOf('stranger', [VIEW_ALL]))).toEqual([T_PRIVATE, T_PUBLIC]);
	});

	it('visibleFilter lehnt ungültige Aliase ab', () => {
		expect(() => access.visibleFilter(ctxOf('x'), [], 't; DROP')).toThrow();
	});

	it('accessForMany: Stufe je Zeile', async () => {
		const rows = [
			{ id: T_PRIVATE, ownerId: 'owner' },
			{ id: T_PUBLIC, ownerId: 'owner' }
		];
		const of = (ctx: RequestContext) =>
			db().transaction((tx) => access.accessForMany(tx, ctx, rows, keysOf(ctx.userId ?? '')));
		const editor = await of(ctxOf('editor'));
		expect(editor.get(T_PRIVATE)).toEqual({ level: 'edit', isOwner: false });
		expect(editor.get(T_PUBLIC)).toEqual({ level: 'read', isOwner: false });
		const owner = await of(ctxOf('owner'));
		expect(owner.get(T_PUBLIC)).toEqual({ level: 'edit', isOwner: true });
		const all = await of(ctxOf('x', [EDIT_ALL]));
		expect(all.get(T_PRIVATE)?.level).toBe('edit');
		expect(
			(await db().transaction((tx) => access.accessForMany(tx, ctxOf('x'), [], []))).size
		).toBe(0);
	});

	it('loadShares/replaceShares: ersetzt vollständig, created_by = Aufrufer', async () => {
		const before = await db().transaction((tx) => access.loadShares(tx, T_PRIVATE));
		expect(before).toEqual([
			{ type: 'user', id: 'editor', level: 'edit' },
			{ type: 'user', id: 'reader', level: 'read' }
		]);
		await db().transaction((tx) =>
			access.replaceShares(tx, ctxOf('owner'), T_PUBLIC, [
				{ type: 'everyone', id: '*', level: 'read' },
				// Duplikat: letzte Stufe gewinnt
				{ type: 'everyone', id: '*', level: 'edit' }
			])
		);
		const rows = await db().transaction((tx) =>
			rowsOf(tx, sql`SELECT level, created_by FROM thing_shares WHERE thing_id = ${T_PUBLIC}`)
		);
		expect(rows).toEqual([{ level: 'edit', created_by: 'owner' }]);
		await db().transaction((tx) => access.replaceShares(tx, ctxOf('owner'), T_PUBLIC, []));
		expect(await db().transaction((tx) => access.loadShares(tx, T_PUBLIC))).toEqual([]);
	});

	it('shareLevelOn/loadObjectShares über mehrere Objekte', async () => {
		const table = { shareTable: 'thing_shares', fk: 'thing_id' };
		const ids = [T_PRIVATE, T_PUBLIC];
		await db().transaction(async (tx) => {
			expect(await shareLevelOn(tx, table, ids, keysOf('editor'))).toBe('edit');
			expect(await shareLevelOn(tx, table, ids, keysOf('reader'))).toBe('read');
			expect(await shareLevelOn(tx, table, ids, keysOf('stranger'))).toBeNull();
			expect(await shareLevelOn(tx, table, [], keysOf('editor'))).toBeNull();
			expect(await shareLevelOn(tx, table, ids, [])).toBeNull();
			const all = await loadObjectShares(tx, table, ids);
			expect(all.map((s) => `${s.objectId}:${s.id}`).sort()).toEqual([
				`${T_PRIVATE}:editor`,
				`${T_PRIVATE}:reader`
			]);
			expect(await loadObjectShares(tx, table, [])).toEqual([]);
		});
	});
});
