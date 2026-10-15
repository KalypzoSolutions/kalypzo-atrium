import { and, asc, count, eq, ilike, inArray, or } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { ADMIN_ROLE_ID } from '../permissions/catalog';
import { assertCanGrant, permissionsOfRole, requirePermission } from '../permissions/service';
import { newId } from '../util';
import { getAuth } from './index';
import { requireUser } from './context';

export interface UserListItem {
	id: string;
	name: string;
	email: string;
	active: boolean;
	twoFactorEnabled: boolean;
	createdAt: Date;
	roles: { id: string; name: string }[];
}

async function rolesByUser(userIds: string[]) {
	if (!userIds.length) return new Map<string, { id: string; name: string }[]>();
	const rows = await getDb()
		.select({ userId: schema.userRole.userId, id: schema.role.id, name: schema.role.name })
		.from(schema.userRole)
		.innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId));
	const map = new Map<string, { id: string; name: string }[]>();
	for (const r of rows) {
		if (!userIds.includes(r.userId)) continue;
		map.set(r.userId, [...(map.get(r.userId) ?? []), { id: r.id, name: r.name }]);
	}
	return map;
}

export async function listUsers(
	ctx: RequestContext,
	opts: { search?: string; limit?: number; offset?: number } = {}
) {
	await requirePermission(ctx, 'core.users.view');
	const db = getDb();
	const s = opts.search?.trim().replace(/[%_\\]/g, '');
	const where = s
		? or(ilike(schema.user.name, `%${s}%`), ilike(schema.user.email, `%${s}%`))
		: undefined;
	const [rows, [total]] = await Promise.all([
		db
			.select()
			.from(schema.user)
			.where(where)
			.orderBy(asc(schema.user.name))
			.limit(Math.min(opts.limit ?? 50, 200))
			.offset(opts.offset ?? 0),
		db.select({ n: count() }).from(schema.user).where(where)
	]);
	const roles = await rolesByUser(rows.map((r) => r.id));
	const items: UserListItem[] = rows.map((u) => ({
		id: u.id,
		name: u.name,
		email: u.email,
		active: u.active,
		twoFactorEnabled: u.twoFactorEnabled,
		createdAt: u.createdAt,
		roles: roles.get(u.id) ?? []
	}));
	return { items, total: total?.n ?? 0 };
}

export async function getUser(ctx: RequestContext, id: string): Promise<UserListItem> {
	await requirePermission(ctx, 'core.users.view');
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, id));
	if (!u) throw errors.notFound('Benutzer nicht gefunden');
	const roles = await rolesByUser([id]);
	return {
		id: u.id,
		name: u.name,
		email: u.email,
		active: u.active,
		twoFactorEnabled: u.twoFactorEnabled,
		createdAt: u.createdAt,
		roles: roles.get(id) ?? []
	};
}

async function assertCanAssignRoles(ctx: RequestContext, roleIds: string[]): Promise<void> {
	for (const roleId of roleIds) {
		const perms = await permissionsOfRole(roleId);
		assertCanGrant(ctx, perms);
	}
}

/** Anzahl aktiver Benutzer mit Administratorrolle, optional ohne `exceptUserId`. */
async function activeAdminCount(exceptUserId?: string): Promise<number> {
	const rows = await getDb()
		.select({ id: schema.user.id })
		.from(schema.userRole)
		.innerJoin(schema.user, eq(schema.user.id, schema.userRole.userId))
		.where(and(eq(schema.userRole.roleId, ADMIN_ROLE_ID), eq(schema.user.active, true)));
	return rows.filter((r) => r.id !== exceptUserId).length;
}

export interface CreateUserInput {
	name: string;
	email: string;
	password: string;
	roleIds?: string[];
}

/** Interner Helfer ohne Rechtepruefung (Bootstrap, Tests). */
export async function createUserUnchecked(input: CreateUserInput): Promise<string> {
	const auth = getAuth();
	const authCtx = await auth.$context;
	const email = input.email.trim().toLowerCase();
	const db = getDb();
	const [existing] = await db
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.email, email));
	if (existing) throw errors.conflict('E-Mail-Adresse wird bereits verwendet');
	const hash = await authCtx.password.hash(input.password);
	const id = newId();
	await db.transaction(async (tx) => {
		await tx
			.insert(schema.user)
			.values({ id, name: input.name.trim(), email, emailVerified: true });
		await tx.insert(schema.account).values({
			id: newId(),
			accountId: id,
			providerId: 'credential',
			userId: id,
			password: hash
		});
		if (input.roleIds?.length) {
			await tx
				.insert(schema.userRole)
				.values(input.roleIds.map((roleId) => ({ userId: id, roleId })));
		}
	});
	return id;
}

export async function createUser(ctx: RequestContext, input: CreateUserInput): Promise<string> {
	await requirePermission(ctx, 'core.users.create');
	if (input.roleIds?.length) {
		await requirePermission(ctx, 'core.roles.assign');
		await assertCanAssignRoles(ctx, input.roleIds);
	}
	if (input.password.length < 12)
		throw errors.badRequest('Passwort muss mindestens 12 Zeichen lang sein');
	const id = await createUserUnchecked(input);
	await auditFromContext(ctx, 'core.user.created', {
		target: id,
		metadata: { email: input.email.toLowerCase(), roleIds: input.roleIds ?? [] }
	});
	return id;
}

export async function updateUser(
	ctx: RequestContext,
	id: string,
	input: { name?: string; email?: string }
): Promise<void> {
	await requirePermission(ctx, 'core.users.edit');
	const patch: Partial<typeof schema.user.$inferInsert> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name.trim();
	if (input.email !== undefined) patch.email = input.email.trim().toLowerCase();
	const res = await getDb()
		.update(schema.user)
		.set(patch)
		.where(eq(schema.user.id, id))
		.returning({ id: schema.user.id });
	if (!res.length) throw errors.notFound('Benutzer nicht gefunden');
	await auditFromContext(ctx, 'core.user.updated', {
		target: id,
		metadata: { fields: Object.keys(input) }
	});
}

export async function setUserActive(
	ctx: RequestContext,
	id: string,
	active: boolean
): Promise<void> {
	await requirePermission(ctx, 'core.users.edit');
	if (!active) {
		if (id === ctx.userId) throw errors.conflict('Sie koennen sich nicht selbst deaktivieren');
		if ((await activeAdminCount(id)) === 0) {
			const roles = await rolesByUser([id]);
			if (roles.get(id)?.some((r) => r.id === ADMIN_ROLE_ID)) {
				throw errors.conflict('Der letzte aktive Administrator kann nicht deaktiviert werden');
			}
		}
	}
	const db = getDb();
	await db.transaction(async (tx) => {
		const res = await tx
			.update(schema.user)
			.set({ active, updatedAt: new Date() })
			.where(eq(schema.user.id, id))
			.returning({ id: schema.user.id });
		if (!res.length) throw errors.notFound('Benutzer nicht gefunden');
		if (!active) await tx.delete(schema.session).where(eq(schema.session.userId, id));
		await auditFromContext(
			ctx,
			active ? 'core.user.activated' : 'core.user.deactivated',
			{ target: id },
			tx
		);
	});
}

export async function deleteUser(ctx: RequestContext, id: string): Promise<void> {
	await requirePermission(ctx, 'core.users.delete');
	if (id === ctx.userId) throw errors.conflict('Sie koennen sich nicht selbst loeschen');
	const roles = await rolesByUser([id]);
	if (roles.get(id)?.some((r) => r.id === ADMIN_ROLE_ID) && (await activeAdminCount(id)) === 0) {
		throw errors.conflict('Der letzte Administrator kann nicht geloescht werden');
	}
	const res = await getDb()
		.delete(schema.user)
		.where(eq(schema.user.id, id))
		.returning({ id: schema.user.id });
	if (!res.length) throw errors.notFound('Benutzer nicht gefunden');
	await auditFromContext(ctx, 'core.user.deleted', { target: id });
}

export async function setUserRoles(
	ctx: RequestContext,
	id: string,
	roleIds: string[]
): Promise<void> {
	await requirePermission(ctx, 'core.roles.assign');
	const db = getDb();
	const unique = [...new Set(roleIds)];
	const existing = unique.length
		? await db
				.select({ id: schema.role.id })
				.from(schema.role)
				.where(inArray(schema.role.id, unique))
		: [];
	if (existing.length !== unique.length) throw errors.badRequest('Unbekannte Rolle');
	const current = (await rolesByUser([id])).get(id) ?? [];
	const added = unique.filter((r) => !current.some((c) => c.id === r));
	const removed = current.filter((c) => !unique.includes(c.id)).map((c) => c.id);
	// Nur Rollen vergeben/entziehen, deren Rechte man selbst besitzt
	await assertCanAssignRoles(ctx, [...added, ...removed]);
	if (removed.includes(ADMIN_ROLE_ID) && (await activeAdminCount(id)) === 0) {
		throw errors.conflict(
			'Dem letzten Administrator kann die Administratorrolle nicht entzogen werden'
		);
	}
	if (id === ctx.userId && removed.length) {
		throw errors.conflict('Sie koennen sich eigene Rollen nicht entziehen');
	}
	await db.transaction(async (tx) => {
		await tx.delete(schema.userRole).where(eq(schema.userRole.userId, id));
		if (unique.length)
			await tx.insert(schema.userRole).values(unique.map((roleId) => ({ userId: id, roleId })));
		await auditFromContext(
			ctx,
			'core.user.roles_changed',
			{ target: id, metadata: { added, removed } },
			tx
		);
	});
}

/** Legt beim ersten Start einen Administrator an (INITIAL_ADMIN_*). Idempotent. */
export async function bootstrapAdmin(email: string, password: string): Promise<boolean> {
	const db = getDb();
	const [anyAdmin] = await db
		.select({ id: schema.userRole.userId })
		.from(schema.userRole)
		.where(eq(schema.userRole.roleId, ADMIN_ROLE_ID))
		.limit(1);
	if (anyAdmin) return false;
	const id = await createUserUnchecked({
		name: 'Administrator',
		email,
		password,
		roleIds: [ADMIN_ROLE_ID]
	});
	await auditFromContext(
		{
			actor: { type: 'system', id: null, name: 'bootstrap' },
			userId: null,
			permissions: new Set(),
			ip: null,
			requestId: 'bootstrap'
		},
		'core.user.created',
		{ target: id, metadata: { bootstrap: true } }
	);
	return true;
}

export interface DirectoryUser {
	id: string;
	name: string;
	email: string;
}

const DIRECTORY_MAX = 30;
const DIRECTORY_MIN_SEARCH = 2;

/**
 * Minimales Benutzerverzeichnis fuer Module (z. B. Freigaben): nur aktive Benutzer, nur
 * `id`, `name`, `email`. Erfordert eine angemeldete Identitaet, aber nicht `core.users.view`.
 * Eine Suche braucht mindestens 2 Zeichen; ohne Suche sind nur explizite `ids` aufloesbar,
 * damit sich nicht die komplette Benutzerliste auslesen laesst.
 */
export async function searchUserDirectory(
	ctx: RequestContext,
	opts: { search?: string; ids?: string[]; limit?: number } = {}
): Promise<DirectoryUser[]> {
	if (ctx.actor.type !== 'system') requireUser(ctx);
	const limit = Math.min(Math.max(opts.limit ?? 20, 1), DIRECTORY_MAX);
	const s = opts.search?.trim().replace(/[%_\\]/g, '') ?? '';
	const ids = (opts.ids ?? []).slice(0, 100);
	if (s.length < DIRECTORY_MIN_SEARCH && ids.length === 0) return [];

	const conditions = [eq(schema.user.active, true)];
	if (ids.length) conditions.push(inArray(schema.user.id, ids));
	if (s.length >= DIRECTORY_MIN_SEARCH) {
		const match = or(ilike(schema.user.name, `%${s}%`), ilike(schema.user.email, `%${s}%`));
		if (match) conditions.push(match);
	}
	return getDb()
		.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
		.from(schema.user)
		.where(and(...conditions))
		.orderBy(asc(schema.user.name))
		.limit(limit);
}
