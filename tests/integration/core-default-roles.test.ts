/**
 * #67 (01a-07): `defaultRoleGrants` und die Selbstregistrierung ordnen Rollen über die stabile Kennung
 * `role.system_key = 'default:<Name>'` zu – nie über den Anzeigenamen (Rollen-Namens-Squatting).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole, updateRole } from '$lib/server/core/permissions/roles';
import {
	adoptDefaultRole,
	defaultRoleKey,
	findDefaultRoleId
} from '$lib/server/core/permissions/default-roles';
import { registerModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';
import { core } from '$lib/server/core';
import type { RequestContext } from '$lib/sdk/types';

const PW = 'correct-horse-battery';
let admin: RequestContext;
let adminId: string;

const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;

function squatModule(id: string, roleName: string) {
	registerModule({
		manifest: {
			id,
			name: id,
			version: '1.0.0',
			dependencies: [],
			permissions: [`${id}.thing.view`, `${id}.thing.manage`],
			navigation: []
		},
		defaultRoleGrants: { [roleName]: [`${id}.thing.view`, `${id}.thing.manage`] }
	});
}

beforeAll(async () => {
	await useTestDatabase();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = u!.id;
	admin = await ctxOf(adminId);
});

describe('Standardrollen per Kennung', () => {
	it('Rolle vorab anlegen → Modul aktivieren: die gleichnamige Rolle erhält keine Modulrechte', async () => {
		// Angreifer*in mit Rollenrechten legt die künftige Modulrolle leer an und weist sie sich zu
		const squatted = await createRole(admin, { name: 'Lagerwart*in', permissions: [] });
		const mallory = await createUser(admin, {
			name: 'Mallory',
			email: 'mallory@example.test',
			password: PW,
			roleIds: [squatted]
		});
		squatModule('squat', 'Lagerwart*in');
		await syncModules();
		await enableModule(admin, 'squat');
		const ctx = await ctxOf(mallory);
		expect(ctx.permissions.has('squat.thing.view')).toBe(false);
		expect(ctx.permissions.has('squat.thing.manage')).toBe(false);
		const perms = await getDb()
			.select()
			.from(schema.rolePermission)
			.where(eq(schema.rolePermission.roleId, squatted));
		expect(perms).toHaveLength(0);
		expect(await findDefaultRoleId('Lagerwart*in')).toBeNull();
	});

	it('Admin übernimmt die Rolle ausdrücklich → Rechte beim nächsten Abgleich', async () => {
		const [role] = await getDb()
			.select()
			.from(schema.role)
			.where(eq(schema.role.name, 'Lagerwart*in'));
		// Ohne Administratorrechte: 403
		const helperRole = await createRole(admin, {
			name: 'Rollenpflege',
			permissions: ['core.roles.edit', 'core.roles.view']
		});
		const helper = await createUser(admin, {
			name: 'Helfer',
			email: 'helfer@example.test',
			password: PW,
			roleIds: [helperRole]
		});
		await expect(adoptDefaultRole(await ctxOf(helper), role!.id)).rejects.toMatchObject({
			code: 'forbidden'
		});
		await adoptDefaultRole(admin, role!.id);
		expect(await findDefaultRoleId('Lagerwart*in')).toBe(role!.id);
		await syncModules();
		const [mallory] = await getDb()
			.select()
			.from(schema.user)
			.where(eq(schema.user.email, 'mallory@example.test'));
		expect((await ctxOf(mallory!.id)).permissions.has('squat.thing.view')).toBe(true);
		// Zweite Übernahme → 409
		await expect(adoptDefaultRole(admin, role!.id)).rejects.toMatchObject({ code: 'conflict' });
	});

	it('ohne Vorab-Rolle: Rolle mit Kennung wird angelegt und behält sie beim Umbenennen', async () => {
		squatModule('fresh', 'Frische Rolle');
		await syncModules();
		await enableModule(admin, 'fresh');
		admin = await ctxOf(adminId);
		const id = await findDefaultRoleId('Frische Rolle');
		expect(id).toBeTruthy();
		const [role] = await getDb().select().from(schema.role).where(eq(schema.role.id, id!));
		expect(role!.systemKey).toBe(defaultRoleKey('Frische Rolle'));
		expect(await core.roles.defaultRoleId('Frische Rolle')).toBe(id);
		// Umbenennen erlaubt (Kennung bleibt), Rückbenennen in den eigenen Namen auch
		await updateRole(admin, id!, { name: 'Umbenannt' });
		await updateRole(admin, id!, { name: 'Frische Rolle' });
	});

	it('reservierte Namen: keine neue oder umbenannte Rolle mit dem Namen einer Standardrolle (409)', async () => {
		const [frische] = await getDb()
			.select()
			.from(schema.role)
			.where(eq(schema.role.name, 'Frische Rolle'));
		await updateRole(admin, frische!.id, { name: 'Frische Rolle (alt)' });
		await expect(
			createRole(admin, { name: 'Frische Rolle', permissions: [] })
		).rejects.toMatchObject({ code: 'conflict' });
		const other = await createRole(admin, { name: 'Irgendwas', permissions: [] });
		await expect(updateRole(admin, other, { name: ' Frische Rolle ' })).rejects.toMatchObject({
			code: 'conflict'
		});
	});

	it('Selbstregistrierung nutzt die Standardrolle, nie eine gleichnamige ohne Kennung', async () => {
		await createRole(admin, { name: 'Gastrolle', permissions: [] });
		await expect(
			core.users.registerWithRole({
				name: 'Gast',
				email: 'gast@example.test',
				password: PW,
				roleName: 'Gastrolle'
			})
		).rejects.toMatchObject({ code: 'unavailable' });
	});

	it('Migration 0008 übernimmt bestehende Rollen mit Markern (Altbestand läuft weiter)', async () => {
		const db = getDb();
		await db.insert(schema.role).values({ id: 'legacy-role', name: 'Altrolle' });
		await db.insert(schema.role).values({ id: 'manual-role', name: 'Handrolle' });
		await db
			.insert(schema.roleGrantApplied)
			.values({ moduleId: 'legacy', roleName: 'Altrolle', permissionKey: 'legacy.thing.view' });
		const migration = readFileSync(
			resolve(process.cwd(), 'drizzle/0008_role_system_key.sql'),
			'utf8'
		);
		const backfill = migration.split('--> statement-breakpoint').pop()!;
		await db.execute(sql.raw(backfill));
		const rows = await db.select().from(schema.role);
		expect(rows.find((r) => r.id === 'legacy-role')!.systemKey).toBe('default:Altrolle');
		expect(rows.find((r) => r.id === 'manual-role')!.systemKey).toBeNull();
		// Administrator (Systemrolle) bekommt nie eine Kennung
		expect(rows.find((r) => r.isSystem)!.systemKey).toBeNull();
		expect(adminId).toBeTruthy();
	});
});
