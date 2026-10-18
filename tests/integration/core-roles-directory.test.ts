import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { contextForUser, anonymousContext, systemContext } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { getDb, schema } from '$lib/server/core/database/client';
import { eq } from 'drizzle-orm';
import { core } from '$lib/server/core';
import { syncModules } from '$lib/server/core/modules/service';
import type { RequestContext } from '$lib/sdk/types';

let admin: RequestContext;
const roles: Record<string, string> = {};
const users: Record<string, string> = {};

async function ctxOf(userId: string) {
	const r = await contextForUser(userId);
	if (!r) throw new Error('kein Kontext');
	return r.ctx;
}

beforeAll(async () => {
	await useTestDatabase();
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(u!.id);
	for (const [key, name] of [
		['woe', 'Leitung Wölflinge'],
		['jpf', 'Leitung Jungpfadfinder'],
		['kasse', 'Kassenwart']
	] as const) {
		roles[key] = await createRole(admin, { name, permissions: [] });
	}
	users.ohne = await createUser(admin, {
		name: 'Ohne Rolle',
		email: 'ohne@example.test',
		password: 'a-long-enough-pw'
	});
	users.zwei = await createUser(admin, {
		name: 'Zwei Rollen',
		email: 'zwei@example.test',
		password: 'a-long-enough-pw',
		roleIds: [roles.woe!, roles.kasse!]
	});
});

describe('core.roles.directory', () => {
	it('findet Rollen ohne core.roles.view, sortiert nach Name, nur id und name', async () => {
		const plain = await ctxOf(users.ohne!);
		expect(plain.permissions.has('core.roles.view')).toBe(false);
		const res = await core.roles.directory(plain, { search: 'leitung' });
		expect(res.map((r) => r.name)).toEqual(['Leitung Jungpfadfinder', 'Leitung Wölflinge']);
		expect(Object.keys(res[0]!).sort()).toEqual(['id', 'name']);
	});

	it('verlangt mindestens 2 Zeichen und liefert sonst nichts', async () => {
		expect(await core.roles.directory(admin, { search: 'k' })).toEqual([]);
		expect(await core.roles.directory(admin, { search: '  ' })).toEqual([]);
		expect(await core.roles.directory(admin, {})).toEqual([]);
		expect(await core.roles.directory(admin, { search: 'ka' })).toHaveLength(1);
	});

	it('löst explizite IDs auf', async () => {
		const res = await core.roles.directory(admin, { ids: [roles.kasse!, roles.woe!, 'unbekannt'] });
		expect(res.map((r) => r.id)).toEqual([roles.kasse, roles.woe]);
	});

	it('kombiniert IDs und Suche', async () => {
		const res = await core.roles.directory(admin, {
			ids: [roles.kasse!, roles.woe!],
			search: 'leitung'
		});
		expect(res.map((r) => r.id)).toEqual([roles.woe]);
	});

	it('maskiert Platzhalter und begrenzt die Trefferzahl', async () => {
		expect(await core.roles.directory(admin, { search: '%%' })).toEqual([]);
		expect(await core.roles.directory(admin, { search: '__' })).toEqual([]);
		const one = await core.roles.directory(admin, { search: 'leitung', limit: 1 });
		expect(one.map((r) => r.name)).toEqual(['Leitung Jungpfadfinder']);
		const many = await core.roles.directory(admin, { search: 'e', ids: [], limit: 999 });
		expect(many.length).toBeLessThanOrEqual(30);
	});

	it('verweigert anonyme Kontexte, Systemkontext darf', async () => {
		await expect(
			core.roles.directory(anonymousContext(null), { search: 'leitung' })
		).rejects.toMatchObject({ code: 'unauthenticated' });
		expect(await core.roles.directory(systemContext(), { search: 'leitung' })).toHaveLength(2);
	});
});

describe('core.users.roleIds', () => {
	it('liefert keine Rollen für Benutzer ohne Rolle', async () => {
		expect(await core.users.roleIds(users.ohne!)).toEqual([]);
	});

	it('liefert alle Rollen eines Benutzers', async () => {
		expect((await core.users.roleIds(users.zwei!)).sort()).toEqual(
			[roles.woe!, roles.kasse!].sort()
		);
	});

	it('liefert für unbekannte Benutzer eine leere Liste', async () => {
		expect(await core.users.roleIds('gibt-es-nicht')).toEqual([]);
	});
});
