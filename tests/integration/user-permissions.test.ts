/**
 * Einzelrechte direkt am Benutzer (`user_permission`): wirksam zusätzlich zu den Rollen, gleiche
 * Schutzregeln gegen Rechteausweitung wie bei Rollen (nur eigene Rechte, admin-gleiche nur Administrator*innen).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import {
	bootstrapAdmin,
	createUser,
	deleteUser,
	getUser,
	setUserRoles,
	updateUserFull
} from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { getUserPermissions } from '$lib/server/core/permissions/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import { listAudit } from '$lib/server/core/audit/service';
import type { RequestContext } from '$lib/sdk/types';

const PW = 'correct-horse-battery';

let close: () => Promise<void>;
let admin: RequestContext;
let assignRole: string;
let n = 0;

const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;
const expectCode = (p: Promise<unknown>, status: number) =>
	expect(p).rejects.toMatchObject({ status });

async function user(roleIds: string[] = [], permissionKeys?: string[]) {
	n++;
	return createUser(admin, {
		name: `Person ${n}`,
		email: `person-${n}@example.test`,
		password: PW,
		roleIds,
		permissionKeys
	});
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [a] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(a!.id);
	assignRole = await createRole(admin, {
		name: 'Zuweisen',
		permissions: ['core.users.view', 'core.users.edit', 'core.roles.assign', 'core.audit.view']
	});
});

afterAll(async () => {
	await close?.();
});

describe('Einzelrechte am Benutzer', () => {
	it('wirken zusätzlich zu den Rollen und stehen in Liste/Detail', async () => {
		const id = await user([], ['core.users.view', 'core.audit.view']);
		const perms = await getUserPermissions(id);
		expect(perms.has('core.users.view')).toBe(true);
		expect(perms.has('core.audit.view')).toBe(true);
		expect(perms.has('core.users.edit')).toBe(false);

		const detail = await getUser(admin, id);
		expect(detail.permissions).toEqual(['core.audit.view', 'core.users.view']);
		expect(detail.roles).toEqual([]);

		// Rollen und Einzelrechte nebeneinander
		await setUserRoles(admin, id, [assignRole]);
		const both = await getUserPermissions(id);
		expect(both.has('core.roles.assign')).toBe(true);
		expect(both.has('core.audit.view')).toBe(true);
	});

	it('ersetzen die Menge, undefined lässt sie unverändert, leere Liste entzieht alle', async () => {
		const id = await user([], ['core.users.view']);
		await updateUserFull(admin, id, { name: 'Neuer Name' });
		expect((await getUser(admin, id)).permissions).toEqual(['core.users.view']);
		await updateUserFull(admin, id, { permissionKeys: ['core.audit.view'] });
		expect((await getUser(admin, id)).permissions).toEqual(['core.audit.view']);
		await updateUserFull(admin, id, { permissionKeys: [] });
		expect((await getUser(admin, id)).permissions).toEqual([]);
		expect((await getUserPermissions(id)).has('core.audit.view')).toBe(false);
	});

	it('unbekannte Schlüssel → 400', async () => {
		const id = await user();
		await expectCode(updateUserFull(admin, id, { permissionKeys: ['core.gibt.es-nicht'] }), 400);
		await expectCode(
			createUser(admin, {
				name: 'X',
				email: 'unbekannt@example.test',
				password: PW,
				permissionKeys: ['core.gibt.es-nicht']
			}),
			400
		);
	});

	it('nur eigene Rechte vergeben; ohne core.roles.assign gar nicht', async () => {
		const actor = await ctxOf(await user([assignRole]));
		const target = await user();
		await updateUserFull(actor, target, { permissionKeys: ['core.audit.view'] });
		// besitzt der Akteur nicht → Rechteausweitung
		await expectCode(
			updateUserFull(actor, target, { permissionKeys: ['core.settings.manage'] }),
			403
		);
		await expectCode(
			createUser(actor, {
				name: 'Y',
				email: 'ausweitung@example.test',
				password: PW,
				permissionKeys: ['core.settings.manage']
			}),
			403
		);
		const noAssign = await createRole(admin, {
			name: 'Nur bearbeiten',
			permissions: ['core.users.view', 'core.users.edit']
		});
		const editor = await ctxOf(await user([noAssign]));
		await expectCode(updateUserFull(editor, target, { permissionKeys: [] }), 403);
	});

	it('Konto mit mehr Rechten (auch durch Einzelrecht) ist nicht änderbar', async () => {
		const actor = await ctxOf(await user([assignRole]));
		const strong = await user([], ['core.settings.manage']);
		await expectCode(updateUserFull(actor, strong, { permissionKeys: [] }), 403);
	});

	it('eigene Einzelrechte lassen sich nicht selbst entziehen', async () => {
		const selfId = await user([assignRole], ['core.audit.view']);
		const self = await ctxOf(selfId);
		await expectCode(updateUserFull(self, selfId, { permissionKeys: [] }), 409);
	});

	it('admin-gleiche Rechte nur durch Administrator*innen', async () => {
		const noAdmin = await ctxOf(await user([assignRole]));
		const target = await user();
		await expectCode(
			updateUserFull(noAdmin, target, { permissionKeys: ['core.privacy.export'] }),
			403
		);
		await updateUserFull(admin, target, { permissionKeys: ['core.privacy.export'] });
		expect((await getUserPermissions(target)).has('core.privacy.export')).toBe(true);
	});

	it('atomar: scheitert die Rollenänderung, bleiben Einzelrechte unverändert', async () => {
		const id = await user();
		await expectCode(
			updateUserFull(admin, id, {
				permissionKeys: ['core.audit.view'],
				roleIds: ['gibt-es-nicht']
			}),
			400
		);
		expect((await getUser(admin, id)).permissions).toEqual([]);
	});

	it('Audit ohne personenbezogene Details; Löschen räumt auf', async () => {
		const id = await user();
		await updateUserFull(admin, id, { permissionKeys: ['core.audit.view'] });
		const { rows } = await listAudit({ action: 'core.user.permissions_changed', target: id });
		const entry = rows[0]!;
		expect(JSON.stringify(entry.metadata)).toContain('core.audit.view');
		expect(JSON.stringify(entry.metadata)).not.toContain('example.test');

		await deleteUser(admin, id);
		const left = await getDb()
			.select()
			.from(schema.userPermission)
			.where(eq(schema.userPermission.userId, id));
		expect(left).toEqual([]);
	});
});
