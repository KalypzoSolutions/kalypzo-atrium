import { count, eq } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { newId } from '../util';
import { ADMIN_ROLE_ID } from './catalog';
import { assertCanGrant, existingKeys, permissionsOfRole, requirePermission } from './service';

export interface RoleItem {
	id: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	permissions: string[];
	userCount: number;
}

export async function listRoles(ctx: RequestContext): Promise<RoleItem[]> {
	await requirePermission(ctx, 'core.roles.view');
	const db = getDb();
	const [roles, perms, users] = await Promise.all([
		db.select().from(schema.role).orderBy(schema.role.name),
		db.select().from(schema.rolePermission),
		db
			.select({ roleId: schema.userRole.roleId, n: count() })
			.from(schema.userRole)
			.groupBy(schema.userRole.roleId)
	]);
	return roles.map((r) => ({
		id: r.id,
		name: r.name,
		description: r.description,
		isSystem: r.isSystem,
		permissions: perms
			.filter((p) => p.roleId === r.id)
			.map((p) => p.permissionKey)
			.sort(),
		userCount: users.find((u) => u.roleId === r.id)?.n ?? 0
	}));
}

async function validateKeys(keys: string[]): Promise<string[]> {
	const unique = [...new Set(keys)];
	const known = await existingKeys(unique);
	const unknown = unique.filter((k) => !known.has(k));
	if (unknown.length) throw errors.badRequest(`Unbekannte Berechtigungen: ${unknown.join(', ')}`);
	return unique;
}

export async function createRole(
	ctx: RequestContext,
	input: { name: string; description?: string; permissions: string[] }
): Promise<string> {
	await requirePermission(ctx, 'core.roles.create');
	const perms = await validateKeys(input.permissions);
	assertCanGrant(ctx, perms);
	const id = newId();
	const db = getDb();
	try {
		await db.transaction(async (tx) => {
			await tx.insert(schema.role).values({
				id,
				name: input.name.trim(),
				description: input.description?.trim() || null
			});
			if (perms.length) {
				await tx
					.insert(schema.rolePermission)
					.values(perms.map((permissionKey) => ({ roleId: id, permissionKey })));
			}
			await auditFromContext(
				ctx,
				'core.role.created',
				{ target: id, metadata: { name: input.name, permissions: perms } },
				tx
			);
		});
	} catch (e) {
		if (String((e as { code?: string }).code) === '23505')
			throw errors.conflict('Rollenname bereits vergeben');
		throw e;
	}
	return id;
}

export async function updateRole(
	ctx: RequestContext,
	id: string,
	input: { name?: string; description?: string; permissions?: string[] }
): Promise<void> {
	await requirePermission(ctx, 'core.roles.edit');
	const db = getDb();
	const [role] = await db.select().from(schema.role).where(eq(schema.role.id, id));
	if (!role) throw errors.notFound('Rolle nicht gefunden');
	if (role.isSystem && (input.name !== undefined || input.permissions !== undefined)) {
		throw errors.forbidden('Systemrollen koennen nicht veraendert werden');
	}
	const current = await permissionsOfRole(id);
	// Eine Rolle darf nur bearbeiten, wer alle ihre Rechte selbst besitzt (sonst Rechte-Entzug/-Umgehung)
	assertCanGrant(ctx, current);
	let next: string[] | undefined;
	if (input.permissions) {
		next = await validateKeys(input.permissions);
		assertCanGrant(ctx, next);
	}
	try {
		await db.transaction(async (tx) => {
			await tx
				.update(schema.role)
				.set({
					...(input.name !== undefined && { name: input.name.trim() }),
					...(input.description !== undefined && { description: input.description.trim() || null }),
					updatedAt: new Date()
				})
				.where(eq(schema.role.id, id));
			if (next) {
				await tx.delete(schema.rolePermission).where(eq(schema.rolePermission.roleId, id));
				if (next.length) {
					await tx
						.insert(schema.rolePermission)
						.values(next.map((permissionKey) => ({ roleId: id, permissionKey })));
				}
			}
			await auditFromContext(
				ctx,
				'core.role.updated',
				{
					target: id,
					metadata: {
						name: input.name,
						added: next?.filter((k) => !current.includes(k)),
						removed: next ? current.filter((k) => !next.includes(k)) : undefined
					}
				},
				tx
			);
		});
	} catch (e) {
		if (String((e as { code?: string }).code) === '23505')
			throw errors.conflict('Rollenname bereits vergeben');
		throw e;
	}
}

export async function deleteRole(ctx: RequestContext, id: string): Promise<void> {
	await requirePermission(ctx, 'core.roles.delete');
	if (id === ADMIN_ROLE_ID) throw errors.forbidden('Systemrollen koennen nicht geloescht werden');
	const db = getDb();
	const [role] = await db.select().from(schema.role).where(eq(schema.role.id, id));
	if (!role) throw errors.notFound('Rolle nicht gefunden');
	if (role.isSystem) throw errors.forbidden('Systemrollen koennen nicht geloescht werden');
	assertCanGrant(ctx, await permissionsOfRole(id));
	await db.transaction(async (tx) => {
		await tx.delete(schema.role).where(eq(schema.role.id, id));
		await auditFromContext(
			ctx,
			'core.role.deleted',
			{ target: id, metadata: { name: role.name } },
			tx
		);
	});
}
