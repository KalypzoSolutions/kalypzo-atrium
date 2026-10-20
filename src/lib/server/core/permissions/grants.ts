/**
 * Rollen, die Module verleihen (`user_role_grant`), z. B. `offices` über Ämter. Getrennt von
 * manuellen Rollen (`user_role`): Ein Modul ersetzt nur seine eigenen Zeilen, und die Rechte
 * gelten nur, solange das Modul aktiv ist (siehe `getUserPermissions`).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { getDb, schema, type DbOrTx } from '../database/client';
import { enabledModuleIds } from '../modules/state';
import { assertCanGrant, permissionsOfRole } from './service';

export interface ModuleRoleGrant {
	userId: string;
	roleIds: string[];
}

/**
 * Ersetzt alle Rollen-Verleihungen eines Moduls atomar. Unbekannte Benutzer oder Rollen werden
 * still übersprungen (z. B. gelöschte Rolle, die noch an einem Amt hängt). Keine Rechteprüfung –
 * das aufrufende Modul prüft vorher mit `assertCanGrantRoles`.
 */
export async function replaceModuleRoleGrants(
	moduleId: string,
	grants: ModuleRoleGrant[]
): Promise<void> {
	const pairs = new Map<string, { userId: string; roleId: string }>();
	for (const g of grants) {
		for (const roleId of g.roleIds)
			pairs.set(`${g.userId}\u0000${roleId}`, { userId: g.userId, roleId });
	}
	const db = getDb();
	await db.transaction(async (tx) => {
		await tx.delete(schema.userRoleGrant).where(eq(schema.userRoleGrant.moduleId, moduleId));
		if (!pairs.size) return;
		const list = [...pairs.values()];
		const [users, roles] = await Promise.all([
			tx
				.select({ id: schema.user.id })
				.from(schema.user)
				.where(inArray(schema.user.id, [...new Set(list.map((p) => p.userId))])),
			tx
				.select({ id: schema.role.id })
				.from(schema.role)
				.where(inArray(schema.role.id, [...new Set(list.map((p) => p.roleId))]))
		]);
		const userIds = new Set(users.map((u) => u.id));
		const roleIds = new Set(roles.map((r) => r.id));
		const values = list
			.filter((p) => userIds.has(p.userId) && roleIds.has(p.roleId))
			.map((p) => ({ ...p, moduleId }));
		if (values.length) await tx.insert(schema.userRoleGrant).values(values);
	});
}

/** Rollen-IDs, die aktive Module dem Benutzer verleihen. */
export async function moduleGrantRoleIds(userId: string, tx?: DbOrTx): Promise<string[]> {
	const db = tx ?? getDb();
	const rows = await db
		.select({ roleId: schema.userRoleGrant.roleId, moduleId: schema.userRoleGrant.moduleId })
		.from(schema.userRoleGrant)
		.where(eq(schema.userRoleGrant.userId, userId));
	if (!rows.length) return [];
	const enabled = await enabledModuleIds(tx);
	return [...new Set(rows.filter((r) => enabled.has(r.moduleId)).map((r) => r.roleId))];
}

/** Alle Verleihungen eines Moduls (Anzeige, Tests). */
export async function listModuleRoleGrants(
	moduleId: string,
	opts: { userId?: string } = {}
): Promise<{ userId: string; roleId: string }[]> {
	const cond = [eq(schema.userRoleGrant.moduleId, moduleId)];
	if (opts.userId) cond.push(eq(schema.userRoleGrant.userId, opts.userId));
	return getDb()
		.select({ userId: schema.userRoleGrant.userId, roleId: schema.userRoleGrant.roleId })
		.from(schema.userRoleGrant)
		.where(and(...cond));
}

/**
 * Schutz vor Rechteausweitung: Wer Rollen (indirekt, z. B. über ein Amt) vergibt oder entzieht,
 * muss alle Rechte dieser Rollen selbst besitzen. Wirft `forbidden`.
 */
export async function assertCanGrantRoles(ctx: RequestContext, roleIds: string[]): Promise<void> {
	for (const roleId of new Set(roleIds)) {
		assertCanGrant(ctx, await permissionsOfRole(roleId));
	}
}
