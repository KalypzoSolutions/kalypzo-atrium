import { eq, inArray } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { getDb, schema, type DbOrTx } from '../database/client';
import { errors } from '../errors';
import { enabledModuleIds } from '../modules/state';
import { ADMIN_ROLE_ID, PERMISSION_PATTERN } from './catalog';

export function assertPermissionKey(key: string): void {
	if (!PERMISSION_PATTERN.test(key)) {
		throw errors.badRequest(`Ungültiger Berechtigungsschlüssel: ${key}`);
	}
}

/**
 * Wirksame Berechtigungen eines Benutzers: Vereinigung aller Rollen, begrenzt auf
 * Berechtigungen aktiver Module (Core ist immer aktiv).
 */
export async function getUserPermissions(userId: string, tx?: DbOrTx): Promise<Set<string>> {
	const db = tx ?? getDb();
	const rows = await db
		.select({ key: schema.permission.key, moduleId: schema.permission.moduleId })
		.from(schema.userRole)
		.innerJoin(schema.rolePermission, eq(schema.rolePermission.roleId, schema.userRole.roleId))
		.innerJoin(schema.permission, eq(schema.permission.key, schema.rolePermission.permissionKey))
		.where(eq(schema.userRole.userId, userId));
	const enabled = await enabledModuleIds(db);
	return new Set(
		rows.filter((r) => r.moduleId === 'core' || enabled.has(r.moduleId)).map((r) => r.key)
	);
}

export function has(ctx: RequestContext, key: string): boolean {
	return ctx.actor.type === 'system' || ctx.permissions.has(key);
}

export function hasAny(ctx: RequestContext, keys: string[]): boolean {
	return keys.some((k) => has(ctx, k));
}

/** Wirft `unauthenticated`/`forbidden`, wenn die Berechtigung fehlt. */
export async function requirePermission(ctx: RequestContext, key: string): Promise<void> {
	assertPermissionKey(key);
	if (ctx.actor.type !== 'system' && !ctx.userId) throw errors.unauthenticated();
	if (!has(ctx, key)) throw errors.forbidden(`Berechtigung fehlt: ${key}`);
}

export async function requireAny(ctx: RequestContext, keys: string[]): Promise<void> {
	if (ctx.actor.type !== 'system' && !ctx.userId) throw errors.unauthenticated();
	if (!hasAny(ctx, keys)) throw errors.forbidden(`Berechtigung fehlt: ${keys.join(' | ')}`);
}

/** Schutz vor Rechteausweitung: nur eigene Berechtigungen dürfen vergeben werden. */
export function assertCanGrant(ctx: RequestContext, keys: Iterable<string>): void {
	if (ctx.actor.type === 'system') return;
	const missing = [...keys].filter((k) => !ctx.permissions.has(k));
	if (missing.length) {
		throw errors.forbidden(
			`Rechteausweitung nicht erlaubt: Sie besitzen diese Berechtigungen nicht (${missing.join(', ')})`
		);
	}
}

export async function listPermissions(tx?: DbOrTx) {
	const db = tx ?? getDb();
	return db.select().from(schema.permission).orderBy(schema.permission.key);
}

/**
 * Gleicht die Berechtigungstabelle mit Core und registrierten Modulen ab und hängt neue
 * Berechtigungen an die Systemrolle `Administrator`.
 */
export async function syncPermissions(
	defs: { key: string; moduleId: string; description?: string }[],
	tx?: DbOrTx
): Promise<void> {
	const db = tx ?? getDb();
	for (const d of defs) assertPermissionKey(d.key);
	if (!defs.length) return;
	await db
		.insert(schema.permission)
		.values(
			defs.map((d) => ({ key: d.key, moduleId: d.moduleId, description: d.description ?? null }))
		)
		.onConflictDoNothing();
	await db
		.insert(schema.role)
		.values({
			id: ADMIN_ROLE_ID,
			name: 'Administrator',
			description: 'Vollzugriff auf alle Funktionen',
			isSystem: true
		})
		.onConflictDoNothing();
	await db
		.insert(schema.rolePermission)
		.values(defs.map((d) => ({ roleId: ADMIN_ROLE_ID, permissionKey: d.key })))
		.onConflictDoNothing();
}

export async function permissionsOfRole(roleId: string, tx?: DbOrTx): Promise<string[]> {
	const db = tx ?? getDb();
	const rows = await db
		.select({ key: schema.rolePermission.permissionKey })
		.from(schema.rolePermission)
		.where(eq(schema.rolePermission.roleId, roleId));
	return rows.map((r) => r.key);
}

export async function existingKeys(keys: string[], tx?: DbOrTx): Promise<Set<string>> {
	if (!keys.length) return new Set();
	const db = tx ?? getDb();
	const rows = await db
		.select({ key: schema.permission.key })
		.from(schema.permission)
		.where(inArray(schema.permission.key, keys));
	return new Set(rows.map((r) => r.key));
}
