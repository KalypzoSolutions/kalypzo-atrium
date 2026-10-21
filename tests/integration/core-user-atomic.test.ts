/**
 * #72 (06-08): `PATCH /users/:id` und die Admin-Aktion ändern Name/E-Mail, Aktiv-Status und Rollen
 * atomar – eine 4xx-Antwort lässt nichts geändert zurück (keine E-Mail, keine widerrufenen Sessions).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser, updateUserFull } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { ADMIN_ROLE_ID } from '$lib/server/core/permissions/catalog';
import { syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { getDb, schema } from '$lib/server/core/database/client';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import type { RequestContext } from '$lib/sdk/types';

const PW = 'correct-horse-battery';
let close: () => Promise<void>;
let admin: RequestContext;
const keys: Record<string, string> = {};
const ids: Record<string, string> = {};

async function patch(who: string, userId: string, json: unknown) {
	resetAllForTests();
	const url = new URL(`http://localhost:5173/api/v1/users/${userId}`);
	const res = await handleApiRequest({
		request: new Request(url, {
			method: 'PATCH',
			headers: { authorization: `Bearer ${keys[who]}`, 'content-type': 'application/json' },
			body: JSON.stringify(json)
		}),
		url,
		ip: '127.0.0.1'
	});
	return { status: res.status, body: await res.json() };
}

async function userRow(id: string) {
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, id));
	const roles = await getDb()
		.select({ roleId: schema.userRole.roleId })
		.from(schema.userRole)
		.where(eq(schema.userRole.userId, id));
	return { ...u!, roleIds: roles.map((r) => r.roleId).sort() };
}

async function addSession(userId: string) {
	await getDb()
		.insert(schema.session)
		.values({
			id: crypto.randomUUID(),
			token: crypto.randomUUID(),
			userId,
			expiresAt: new Date(Date.now() + 3600_000),
			createdAt: new Date(),
			updatedAt: new Date()
		});
}

async function sessionCount(userId: string) {
	return (
		await getDb()
			.select({ id: schema.session.id })
			.from(schema.session)
			.where(eq(schema.session.userId, userId))
	).length;
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = (await contextForUser(u!.id))!.ctx;
	// Verwalter*in: darf Benutzer bearbeiten und Rollen zuweisen, hat aber nicht alle Rechte
	const managerRole = await createRole(admin, {
		name: 'Verwaltung',
		permissions: ['core.api.manage', 'core.users.view', 'core.users.edit', 'core.roles.assign']
	});
	// nur bearbeiten, keine Rollen zuweisen
	const editorRole = await createRole(admin, {
		name: 'Bearbeitung',
		permissions: ['core.api.manage', 'core.users.view', 'core.users.edit']
	});
	ids.manager = await createUser(admin, {
		name: 'Mia Manager',
		email: 'manager@example.test',
		password: PW,
		roleIds: [managerRole]
	});
	ids.editor = await createUser(admin, {
		name: 'Eda Editor',
		email: 'editor@example.test',
		password: PW,
		roleIds: [editorRole]
	});
	ids.target = await createUser(admin, {
		name: 'Tim Target',
		email: 'target@example.test',
		password: PW,
		roleIds: []
	});
	for (const who of ['manager', 'editor'] as const) {
		const ctx = (await contextForUser(ids[who]!))!.ctx;
		keys[who] = (await createApiKey(ctx, { name: who, scopes: [...ctx.permissions] })).key;
	}
});

afterAll(async () => {
	await close();
});

describe('PATCH /users/:id atomar', () => {
	it('verbotene Rolle → 403, E-Mail/Name unverändert, Sessions bleiben', async () => {
		await addSession(ids.target!);
		const before = await userRow(ids.target!);
		const res = await patch('manager', ids.target!, {
			name: 'Neu',
			email: 'neu@example.test',
			roleIds: [ADMIN_ROLE_ID]
		});
		expect(res.status).toBe(403);
		const after = await userRow(ids.target!);
		expect(after.email).toBe(before.email);
		expect(after.name).toBe(before.name);
		expect(after.roleIds).toEqual(before.roleIds);
		expect(await sessionCount(ids.target!)).toBe(1);
	});

	it('ohne core.roles.assign → 403, Name und Aktiv-Status unverändert', async () => {
		const res = await patch('editor', ids.target!, { name: 'Neu', active: false, roleIds: [] });
		expect(res.status).toBe(403);
		const after = await userRow(ids.target!);
		expect(after.name).toBe('Tim Target');
		expect(after.active).toBe(true);
		expect(await sessionCount(ids.target!)).toBe(1);
	});

	it('unbekannte Rolle → 400, nichts geändert', async () => {
		const res = await patch('manager', ids.target!, {
			email: 'neu2@example.test',
			roleIds: ['gibt-es-nicht']
		});
		expect(res.status).toBe(400);
		expect((await userRow(ids.target!)).email).toBe('target@example.test');
	});

	it('E-Mail-Duplikat → 409, Rollen unverändert', async () => {
		const role = await createRole(admin, { name: 'Leer', permissions: [] });
		const res = await patch('manager', ids.target!, {
			email: 'editor@example.test',
			roleIds: [role]
		});
		expect(res.status).toBe(409);
		expect((await userRow(ids.target!)).roleIds).toEqual([]);
	});

	it('alles erlaubt → alle Teile in einem Schritt, Sessions widerrufen', async () => {
		const role = await createRole(admin, { name: 'Erlaubt', permissions: ['core.users.view'] });
		const res = await patch('manager', ids.target!, {
			name: 'Tina Target',
			email: 'tina@example.test',
			active: true,
			roleIds: [role]
		});
		expect(res.status, JSON.stringify(res.body)).toBe(200);
		const after = await userRow(ids.target!);
		expect(after).toMatchObject({ name: 'Tina Target', email: 'tina@example.test', active: true });
		expect(after.roleIds).toEqual([role]);
		expect(await sessionCount(ids.target!)).toBe(0);
	});

	it('updateUserFull: Selbst-Deaktivierung scheitert, Name bleibt', async () => {
		const self = (await contextForUser(ids.manager!))!.ctx;
		await expect(
			updateUserFull(self, ids.manager!, { name: 'Anders', active: false })
		).rejects.toMatchObject({ status: 409 });
		expect((await userRow(ids.manager!)).name).toBe('Mia Manager');
	});
});
