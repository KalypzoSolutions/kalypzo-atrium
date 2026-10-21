import { eq, inArray, sql } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { getDb, schema, type DbOrTx } from '../database/client';
import { errors } from '../errors';
import { enabledModuleIds } from '../modules/state';
import {
	ADMIN_ROLE_ID,
	CORE_PERMISSIONS,
	PERMISSION_PATTERN,
	PRIVILEGED_PERMISSIONS
} from './catalog';

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
	// Rollen, die Module verleihen (z. B. Ämter) – nur solange das verleihende Modul aktiv ist
	const granted = await db
		.select({
			key: schema.permission.key,
			moduleId: schema.permission.moduleId,
			grantModuleId: schema.userRoleGrant.moduleId
		})
		.from(schema.userRoleGrant)
		.innerJoin(schema.rolePermission, eq(schema.rolePermission.roleId, schema.userRoleGrant.roleId))
		.innerJoin(schema.permission, eq(schema.permission.key, schema.rolePermission.permissionKey))
		.where(eq(schema.userRoleGrant.userId, userId));
	// Ohne übergebene Transaktion den kurzen Modulstatus-Cache nutzen (#23: je Request eine Query weniger)
	const enabled = await enabledModuleIds(tx);
	return new Set(
		[...rows, ...granted.filter((g) => enabled.has(g.grantModuleId))]
			.filter((r) => r.moduleId === 'core' || enabled.has(r.moduleId))
			.map((r) => r.key)
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

/**
 * Administrator*in im Sinne der privilegierten Rechte: System-Kontext oder wer **sämtliche** Core-Rechte
 * wirksam besitzt (die Rolle „Administrator“ bekommt sie immer). Synchron aus dem Kontext, damit jede
 * Vergabe-Prüfung (`assertCanGrant`) ohne Datenbankzugriff auskommt. Ein API-Key mit eingeschränkten
 * Scopes zählt nicht.
 */
export function isAdministrator(ctx: RequestContext): boolean {
	if (ctx.actor.type === 'system') return true;
	return Object.keys(CORE_PERMISSIONS).every((k) => ctx.permissions.has(k));
}

/** Admin-gleiches Recht (`PRIVILEGED_PERMISSIONS`)? */
export function isPrivilegedPermission(key: string): boolean {
	return PRIVILEGED_PERMISSIONS.has(key);
}

/** Darf `ctx` dieses Recht vergeben? (selbst besitzen; privilegierte nur als Administrator*in) */
export function canGrantPermission(ctx: RequestContext, key: string): boolean {
	if (ctx.actor.type === 'system') return true;
	if (!ctx.permissions.has(key)) return false;
	return !isPrivilegedPermission(key) || isAdministrator(ctx);
}

/**
 * Schutz vor Rechteausweitung: nur eigene Berechtigungen dürfen vergeben werden; admin-gleiche Rechte
 * (`PRIVILEGED_PERMISSIONS`) nur von Administrator*innen. Gilt für Rollen anlegen/bearbeiten/löschen,
 * Rollen zuweisen (auch über Ämter) und API-Key-Scopes.
 */
export function assertCanGrant(ctx: RequestContext, keys: Iterable<string>): void {
	if (ctx.actor.type === 'system') return;
	const list = [...keys];
	const missing = list.filter((k) => !ctx.permissions.has(k));
	if (missing.length) {
		throw errors.forbidden(
			`Rechteausweitung nicht erlaubt: Sie besitzen diese Berechtigungen nicht (${missing.join(', ')})`
		);
	}
	const privileged = [...new Set(list.filter(isPrivilegedPermission))];
	if (privileged.length && !isAdministrator(ctx)) {
		throw errors.forbidden(
			`Admin-gleiche Berechtigungen dürfen nur Administrator*innen vergeben (${privileged.join(', ')})`
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
		// Beschreibungen aus dem Code nachziehen; ohne neue Beschreibung bleibt die bisherige
		.onConflictDoUpdate({
			target: schema.permission.key,
			set: { description: sql`coalesce(excluded.description, ${schema.permission.description})` }
		});
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
