import { and, asc, count, eq, ilike, inArray, or } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema, type Tx } from '../database/client';
import { errors } from '../errors';
import { ADMIN_ROLE_ID } from '../permissions/catalog';
import { ensureDefaultRole } from '../permissions/default-roles';
import {
	assertCanGrant,
	directPermissionsOfUser,
	existingKeys,
	permissionsOfRole,
	requirePermission
} from '../permissions/service';
import { forModule } from '../database/module-db';
import { sendMail } from '../mail';
import { allDefinitions } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';
import { getSetting } from '../settings/service';
import { newId } from '../util';
import { getAuth } from './index';
import { requireUser } from './context';
import { assertCanManageUser } from './manage-guard';
import { maskEmail } from './mask-email';
import { removeAvatarObject } from './profile';

export interface UserListItem {
	id: string;
	name: string;
	email: string;
	active: boolean;
	twoFactorEnabled: boolean;
	/** E-Mail-Adresse bestätigt (Selbstregistrierung über den Verknüpfungsbrief startet mit `false`) */
	emailVerified: boolean;
	createdAt: Date;
	roles: { id: string; name: string }[];
	/** Einzelrechte, die direkt am Benutzer hängen (zusätzlich zu den Rollen) */
	permissions: string[];
	/** Profilbild-Adresse (`/avatar/<id>?v=…`) oder `null` */
	image: string | null;
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

async function permissionsByUser(userIds: string[]) {
	const map = new Map<string, string[]>();
	if (!userIds.length) return map;
	const rows = await getDb()
		.select({
			userId: schema.userPermission.userId,
			key: schema.userPermission.permissionKey
		})
		.from(schema.userPermission)
		.where(inArray(schema.userPermission.userId, userIds));
	for (const r of rows) map.set(r.userId, [...(map.get(r.userId) ?? []), r.key]);
	for (const list of map.values()) list.sort();
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
	const ids = rows.map((r) => r.id);
	const roles = await rolesByUser(ids);
	const direct = await permissionsByUser(ids);
	const items: UserListItem[] = rows.map((u) => ({
		id: u.id,
		name: u.name,
		email: u.email,
		active: u.active,
		twoFactorEnabled: u.twoFactorEnabled,
		emailVerified: u.emailVerified,
		createdAt: u.createdAt,
		roles: roles.get(u.id) ?? [],
		permissions: direct.get(u.id) ?? [],
		image: directoryAvatar(u.id, u.image)
	}));
	return { items, total: total?.n ?? 0 };
}

export async function getUser(ctx: RequestContext, id: string): Promise<UserListItem> {
	await requirePermission(ctx, 'core.users.view');
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, id));
	if (!u) throw errors.notFound('Benutzer nicht gefunden');
	const roles = await rolesByUser([id]);
	const direct = await permissionsByUser([id]);
	return {
		id: u.id,
		name: u.name,
		email: u.email,
		active: u.active,
		twoFactorEnabled: u.twoFactorEnabled,
		emailVerified: u.emailVerified,
		createdAt: u.createdAt,
		roles: roles.get(id) ?? [],
		permissions: direct.get(id) ?? [],
		image: directoryAvatar(u.id, u.image)
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
	/** Einzelrechte direkt am Benutzer (zusätzlich zu den Rollen) */
	permissionKeys?: string[];
}

/**
 * Interner Helfer ohne Rechteprüfung (Bootstrap, Tests). Administrativ angelegte Konten gelten als
 * bestätigt; `emailVerified: false` nur für die Selbstregistrierung (Anmeldung erst nach Bestätigung).
 */
export async function createUserUnchecked(
	input: CreateUserInput & { emailVerified?: boolean }
): Promise<string> {
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
		await tx.insert(schema.user).values({
			id,
			name: input.name.trim(),
			email,
			emailVerified: input.emailVerified ?? true
		});
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
		const keys = [...new Set(input.permissionKeys ?? [])];
		if (keys.length) {
			await tx
				.insert(schema.userPermission)
				.values(keys.map((permissionKey) => ({ userId: id, permissionKey })));
		}
	});
	return id;
}

/**
 * Konto für die öffentliche Selbstregistrierung (Aufrufer prüft vorher, dass das erlaubt ist):
 * Standardrolle per Kennung `default:<Name>` (sonst ohne Rechte angelegt; belegt eine gleichnamige Rolle
 * ohne Kennung den Namen → 503). Kein Audit-Kontext (Aufrufer auditiert).
 * Das Konto ist **unbestätigt** (`emailVerified = false`): An die Adresse geht ein Bestätigungslink
 * (1 h, Better Auth `sendVerificationEmail`); anmelden lässt es sich erst danach (#18).
 */
export async function registerUserWithRole(input: {
	name: string;
	email: string;
	password: string;
	roleName: string;
}): Promise<string> {
	const name = input.name.trim();
	if (!name || name.length > 120) throw errors.badRequest('Ungültiger Name');
	if (input.password.length < 12 || input.password.length > 128) {
		throw errors.badRequest('Passwort muss 12 bis 128 Zeichen lang sein');
	}
	// Standardrolle über ihre Kennung `default:<Name>` – nie eine bloß gleichnamige Rolle (#67, 01a-07)
	const roleId = await ensureDefaultRole(input.roleName);
	if (!roleId) {
		throw errors.unavailable(
			'Die Registrierung ist gerade nicht möglich – bitte wende dich an die Administration'
		);
	}
	const id = await createUserUnchecked({
		name,
		email: input.email,
		password: input.password,
		roleIds: [roleId],
		emailVerified: false
	});
	try {
		await getAuth().api.sendVerificationEmail({
			body: { email: input.email.trim().toLowerCase(), callbackURL: '/login?verified=1' }
		});
	} catch (err) {
		// Konto bleibt unbestätigt; ein Anmeldeversuch mit richtigem Passwort schickt einen neuen Link
		console.error('[auth] Bestätigungslink nicht versendet:', (err as Error)?.message);
	}
	return id;
}

export async function createUser(ctx: RequestContext, input: CreateUserInput): Promise<string> {
	await requirePermission(ctx, 'core.users.create');
	if (input.roleIds?.length) {
		await requirePermission(ctx, 'core.roles.assign');
		await assertCanAssignRoles(ctx, input.roleIds);
	}
	if (input.permissionKeys?.length) {
		await requirePermission(ctx, 'core.roles.assign');
		await assertValidPermissionKeys(input.permissionKeys);
		assertCanGrant(ctx, input.permissionKeys);
	}
	if (input.password.length < 12)
		throw errors.badRequest('Passwort muss mindestens 12 Zeichen lang sein');
	const id = await createUserUnchecked(input);
	await auditFromContext(ctx, 'core.user.created', {
		target: id,
		metadata: {
			email: maskEmail(input.email.trim().toLowerCase()),
			roleIds: input.roleIds ?? [],
			permissionKeys: [...new Set(input.permissionKeys ?? [])]
		}
	});
	return id;
}

interface UserUpdatePlan {
	patch: Partial<typeof schema.user.$inferInsert>;
	emailChanged: boolean;
	current: { email: string; name: string };
	fields: string[];
}

/** Prüft Rechte und Eingaben für Name/E-Mail, ohne etwas zu ändern. */
async function planUserUpdate(
	ctx: RequestContext,
	id: string,
	input: { name?: string; email?: string }
): Promise<UserUpdatePlan> {
	await requirePermission(ctx, 'core.users.edit');
	const db = getDb();
	const [current] = await db
		.select({ email: schema.user.email, name: schema.user.name })
		.from(schema.user)
		.where(eq(schema.user.id, id));
	if (!current) throw errors.notFound('Benutzer nicht gefunden');
	// Die E-Mail-Adresse steuert den Zugang (Passwort vergessen) – nur Konten mit höchstens eigenen Rechten
	await assertCanManageUser(ctx, id);
	const patch: Partial<typeof schema.user.$inferInsert> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name.trim();
	let emailChanged = false;
	if (input.email !== undefined) {
		const email = input.email.trim().toLowerCase();
		if (email !== current.email) {
			const [dup] = await db
				.select({ id: schema.user.id })
				.from(schema.user)
				.where(eq(schema.user.email, email));
			if (dup) throw errors.conflict('E-Mail-Adresse wird bereits verwendet');
			patch.email = email;
			// Administrativ geänderte Adresse gilt als verifiziert
			patch.emailVerified = true;
			emailChanged = true;
		}
	}
	const fields = Object.entries(input)
		.filter(([, v]) => v !== undefined)
		.map(([k]) => k);
	return { patch, emailChanged, current, fields };
}

async function applyUserUpdate(
	tx: Tx,
	ctx: RequestContext,
	id: string,
	plan: UserUpdatePlan
): Promise<void> {
	await tx.update(schema.user).set(plan.patch).where(eq(schema.user.id, id));
	// Alte Sessions gehören zur alten Adresse
	if (plan.emailChanged) await tx.delete(schema.session).where(eq(schema.session.userId, id));
	await auditFromContext(
		ctx,
		'core.user.updated',
		{
			target: id,
			metadata: {
				fields: plan.fields,
				sessionsRevoked: plan.emailChanged,
				...(plan.emailChanged
					? { emailFrom: maskEmail(plan.current.email), emailTo: maskEmail(plan.patch.email!) }
					: {})
			}
		},
		tx
	);
}

export async function updateUser(
	ctx: RequestContext,
	id: string,
	input: { name?: string; email?: string }
): Promise<void> {
	await updateUserFull(ctx, id, input);
}

/**
 * Ändert Name/E-Mail, Aktiv-Status und Rollen **atomar** (#72, 06-08): Alle Rechte- und
 * Eingabeprüfungen laufen vor der ersten Änderung, danach eine Transaktion. Scheitert ein Teil
 * (403/409/400), bleibt alles unverändert – auch die E-Mail-Adresse und die Sessions.
 * `roleIds` ersetzt die manuellen Rollen (`undefined` = unverändert).
 */
export async function updateUserFull(
	ctx: RequestContext,
	id: string,
	input: {
		name?: string;
		email?: string;
		active?: boolean;
		roleIds?: string[];
		permissionKeys?: string[];
	}
): Promise<void> {
	const { active, roleIds, permissionKeys, ...profile } = input;
	const hasProfile = profile.name !== undefined || profile.email !== undefined;
	const profilePlan = hasProfile ? await planUserUpdate(ctx, id, profile) : null;
	if (active !== undefined) await planUserActive(ctx, id, active);
	const rolesPlan = roleIds ? await planUserRoles(ctx, id, roleIds) : null;
	const permsPlan = permissionKeys ? await planUserPermissions(ctx, id, permissionKeys) : null;
	if (!profilePlan && active === undefined && !rolesPlan && !permsPlan) {
		await requirePermission(ctx, 'core.users.edit');
		return;
	}
	await getDb().transaction(async (tx) => {
		if (profilePlan) await applyUserUpdate(tx, ctx, id, profilePlan);
		if (active !== undefined) await applyUserActive(tx, ctx, id, active);
		if (rolesPlan) await applyUserRoles(tx, ctx, id, rolesPlan);
		if (permsPlan) await applyUserPermissions(tx, ctx, id, permsPlan);
	});
	if (profilePlan?.emailChanged) {
		notifyOldAddress(profilePlan.current.email, profilePlan.current.name, profilePlan.patch.email!);
	}
}

/**
 * Hinweis an die bisherige Adresse nach einem administrativen E-Mail-Wechsel (Fire-and-forget wie bei
 * `requestEmailChange`): Wer die Adresse nicht selbst geändert hat, merkt eine Übernahme sofort.
 */
function notifyOldAddress(oldEmail: string, name: string, newEmail: string): void {
	void (async () => {
		const system = (await getSetting<string>('core.system.name')) || 'EP Intern';
		await sendMail({
			to: oldEmail,
			subject: `${system}: Die E-Mail-Adresse deines Kontos wurde geändert`,
			text: `Hallo ${name},\n\ndie E-Mail-Adresse deines Kontos wurde von der Administration auf ${maskEmail(newEmail)} geändert. An diese Adresse gehen ab sofort alle Nachrichten, auch Links zum Zurücksetzen des Passworts. Alle bisherigen Anmeldungen wurden beendet.\n\nWenn diese Änderung nicht mit dir abgesprochen war, melde dich bitte umgehend bei der Administration.`
		});
	})().catch((err) =>
		console.error('[mail] Hinweis zum E-Mail-Wechsel fehlgeschlagen:', err?.message)
	);
}

async function planUserActive(ctx: RequestContext, id: string, active: boolean): Promise<void> {
	await requirePermission(ctx, 'core.users.edit');
	await assertCanManageUser(ctx, id);
	if (!active) {
		if (id === ctx.userId) throw errors.conflict('Du kannst dich nicht selbst deaktivieren');
		if ((await activeAdminCount(id)) === 0) {
			const roles = await rolesByUser([id]);
			if (roles.get(id)?.some((r) => r.id === ADMIN_ROLE_ID)) {
				throw errors.conflict('Der letzte aktive Administrator kann nicht deaktiviert werden');
			}
		}
	}
}

async function applyUserActive(
	tx: Tx,
	ctx: RequestContext,
	id: string,
	active: boolean
): Promise<void> {
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
}

/**
 * Bestätigt die E-Mail-Adresse eines Kontos von Hand (z. B. wenn der Bestätigungslink nicht ankam).
 * Danach ist die Anmeldung möglich. Gleiche Schutzregeln wie andere Kontoänderungen.
 */
export async function verifyUserEmail(ctx: RequestContext, id: string): Promise<void> {
	await requirePermission(ctx, 'core.users.edit');
	await assertCanManageUser(ctx, id);
	const res = await getDb()
		.update(schema.user)
		.set({ emailVerified: true, updatedAt: new Date() })
		.where(eq(schema.user.id, id))
		.returning({ id: schema.user.id });
	if (!res.length) throw errors.notFound('Benutzer nicht gefunden');
	await auditFromContext(ctx, 'core.user.email_verified', { target: id });
}

export async function setUserActive(
	ctx: RequestContext,
	id: string,
	active: boolean
): Promise<void> {
	await updateUserFull(ctx, id, { active });
}

export async function deleteUser(ctx: RequestContext, id: string): Promise<void> {
	await requirePermission(ctx, 'core.users.delete');
	if (id === ctx.userId) throw errors.conflict('Du kannst dich nicht selbst löschen');
	await assertCanManageUser(ctx, id);
	const roles = await rolesByUser([id]);
	if (roles.get(id)?.some((r) => r.id === ADMIN_ROLE_ID) && (await activeAdminCount(id)) === 0) {
		throw errors.conflict('Der letzte Administrator kann nicht gelöscht werden');
	}
	const res = await getDb()
		.delete(schema.user)
		.where(eq(schema.user.id, id))
		.returning({ id: schema.user.id });
	if (!res.length) throw errors.notFound('Benutzer nicht gefunden');
	// Nach dem Core-Löschen: Profilbild und Moduldaten der Person aufräumen (wirft nie)
	await removeAvatarObject(id);
	const failed = await cleanupModulesAfterUserDeletion(id, ctx.userId);
	await auditFromContext(ctx, 'core.user.deleted', {
		target: id,
		metadata: failed.length ? { cleanupFailed: failed } : undefined
	});
}

/**
 * Ruft `onUserDeleted` aller aktiven Module auf (je Modul eigene Modul-Transaktion, danach
 * `afterCommit`). Fehler eines Moduls werden protokolliert und brechen nicht ab; Rückgabe = Modul-IDs
 * mit Fehler (für das Audit).
 */
export async function cleanupModulesAfterUserDeletion(
	userId: string,
	transferTo: string | null
): Promise<string[]> {
	const failed: string[] = [];
	for (const def of allDefinitions()) {
		const hook = def.onUserDeleted;
		if (!hook) continue;
		const moduleId = def.manifest.id;
		try {
			if (!(await isModuleEnabled(moduleId))) continue;
			const result = await forModule(moduleId).transaction((tx) =>
				hook(tx, { userId, transferTo })
			);
			if (result?.afterCommit) await result.afterCommit();
		} catch (err) {
			failed.push(moduleId);
			console.error(
				`[users] Aufräumen im Modul ${moduleId} nach dem Löschen eines Kontos fehlgeschlagen:`,
				(err as Error)?.message
			);
		}
	}
	return failed;
}

interface UserRolesPlan {
	unique: string[];
	added: string[];
	removed: string[];
}

async function planUserRoles(
	ctx: RequestContext,
	id: string,
	roleIds: string[]
): Promise<UserRolesPlan> {
	await requirePermission(ctx, 'core.roles.assign');
	// Rollen nur bei Konten ändern, deren Rechte man selbst vollständig besitzt
	await assertCanManageUser(ctx, id);
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
		throw errors.conflict('Du kannst dir eigene Rollen nicht entziehen');
	}
	return { unique, added, removed };
}

async function applyUserRoles(
	tx: Tx,
	ctx: RequestContext,
	id: string,
	plan: UserRolesPlan
): Promise<void> {
	await tx.delete(schema.userRole).where(eq(schema.userRole.userId, id));
	if (plan.unique.length)
		await tx.insert(schema.userRole).values(plan.unique.map((roleId) => ({ userId: id, roleId })));
	await auditFromContext(
		ctx,
		'core.user.roles_changed',
		{ target: id, metadata: { added: plan.added, removed: plan.removed } },
		tx
	);
}

interface UserPermissionsPlan {
	unique: string[];
	added: string[];
	removed: string[];
}

async function assertValidPermissionKeys(keys: string[]): Promise<void> {
	const unique = [...new Set(keys)];
	const known = await existingKeys(unique);
	if (unique.some((k) => !known.has(k))) throw errors.badRequest('Unbekannte Berechtigung');
}

/**
 * Einzelrechte direkt am Benutzer: gleiche Schutzregeln wie bei Rollen – Recht zum Zuweisen, Zielkonto
 * höchstens mit eigenen Rechten, nur eigene (und admin-gleiche nur als Administrator*in) vergeben/entziehen,
 * keine eigenen Rechte entziehen.
 */
async function planUserPermissions(
	ctx: RequestContext,
	id: string,
	keys: string[]
): Promise<UserPermissionsPlan> {
	await requirePermission(ctx, 'core.roles.assign');
	await assertCanManageUser(ctx, id);
	const unique = [...new Set(keys)];
	await assertValidPermissionKeys(unique);
	const current = await directPermissionsOfUser(id);
	const added = unique.filter((k) => !current.includes(k));
	const removed = current.filter((k) => !unique.includes(k));
	assertCanGrant(ctx, [...added, ...removed]);
	if (id === ctx.userId && removed.length) {
		throw errors.conflict('Du kannst dir eigene Berechtigungen nicht entziehen');
	}
	return { unique, added, removed };
}

async function applyUserPermissions(
	tx: Tx,
	ctx: RequestContext,
	id: string,
	plan: UserPermissionsPlan
): Promise<void> {
	await tx.delete(schema.userPermission).where(eq(schema.userPermission.userId, id));
	if (plan.unique.length) {
		await tx
			.insert(schema.userPermission)
			.values(plan.unique.map((permissionKey) => ({ userId: id, permissionKey })));
	}
	await auditFromContext(
		ctx,
		'core.user.permissions_changed',
		{ target: id, metadata: { added: plan.added, removed: plan.removed } },
		tx
	);
}

export async function setUserRoles(
	ctx: RequestContext,
	id: string,
	roleIds: string[]
): Promise<void> {
	await updateUserFull(ctx, id, { roleIds });
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
	/** Profilbild-Adresse (`/avatar/<id>?v=…`) oder `null` */
	image: string | null;
}

const DIRECTORY_MAX = 30;
const DIRECTORY_MIN_SEARCH = 2;

/**
 * Minimales Benutzerverzeichnis für Module (z. B. Freigaben): nur aktive Benutzer, nur
 * `id`, `name`, `email`, `image`. Erfordert eine angemeldete Identität, aber nicht `core.users.view`.
 * Eine Suche braucht mindestens 2 Zeichen; ohne Suche sind nur explizite `ids` auflösbar,
 * damit sich nicht die komplette Benutzerliste auslesen lässt.
 *
 * Datenminimierung: Die E-Mail-Adresse gibt es nur für System-Kontexte, mit `core.users.view` und für
 * das eigene Konto – sonst ist `email` ein leerer String. Ohne dieses Recht sucht `search` auch nur im
 * Namen (keine Rückschlüsse über E-Mail-Teile). Module, die Adressen für den Versand brauchen, lösen
 * sie mit dem System-Kontext auf (`core.auth.systemContext`). `includeEmail: true` ist nur für
 * Verwaltungsfunktionen gedacht, deren eigenes Recht die Adresse fachlich braucht und die dieses
 * Recht VORHER geprüft haben (z. B. Konto-Verknüpfung in `members` mit `members.link.*`).
 */
export async function searchUserDirectory(
	ctx: RequestContext,
	opts: { search?: string; ids?: string[]; limit?: number; includeEmail?: boolean } = {}
): Promise<DirectoryUser[]> {
	if (ctx.actor.type !== 'system') requireUser(ctx);
	const canSeeEmail =
		ctx.actor.type === 'system' ||
		ctx.permissions.has('core.users.view') ||
		opts.includeEmail === true;
	const limit = Math.min(Math.max(opts.limit ?? 20, 1), DIRECTORY_MAX);
	const s = opts.search?.trim().replace(/[%_\\]/g, '') ?? '';
	const ids = (opts.ids ?? []).slice(0, 100);
	if (s.length < DIRECTORY_MIN_SEARCH && ids.length === 0) return [];

	const conditions = [eq(schema.user.active, true)];
	if (ids.length) conditions.push(inArray(schema.user.id, ids));
	if (s.length >= DIRECTORY_MIN_SEARCH) {
		const match = canSeeEmail
			? or(ilike(schema.user.name, `%${s}%`), ilike(schema.user.email, `%${s}%`))
			: ilike(schema.user.name, `%${s}%`);
		if (match) conditions.push(match);
	}
	const rows = await getDb()
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			image: schema.user.image
		})
		.from(schema.user)
		.where(and(...conditions))
		.orderBy(asc(schema.user.name))
		.limit(limit);
	return rows.map((r) => ({
		...r,
		email: canSeeEmail || r.id === ctx.userId ? r.email : '',
		image: directoryAvatar(r.id, r.image)
	}));
}

/**
 * Aktive Benutzer*innen zu IDs als Map (`id` → Eintrag wie `directory`), stückelt intern in 30er-Blöcke.
 * Gleiche Sichtbarkeitsregeln wie `searchUserDirectory` (E-Mail nur mit `core.users.view`/`includeEmail`);
 * unbekannte und deaktivierte Konten fehlen in der Map. Doppelte und leere IDs werden ignoriert.
 */
export async function usersByIds(
	ctx: RequestContext,
	ids: Iterable<string | null | undefined>,
	opts: { includeEmail?: boolean } = {}
): Promise<Map<string, DirectoryUser>> {
	const unique = [...new Set([...ids].filter((id): id is string => !!id))];
	const map = new Map<string, DirectoryUser>();
	for (let i = 0; i < unique.length; i += DIRECTORY_MAX) {
		const chunk = unique.slice(i, i + DIRECTORY_MAX);
		const found = await searchUserDirectory(ctx, {
			ids: chunk,
			limit: DIRECTORY_MAX,
			includeEmail: opts.includeEmail
		});
		for (const u of found) map.set(u.id, u);
	}
	return map;
}

/**
 * Nur eigene Profilbild-Adressen (`/avatar/<id>` bzw. `/avatar/<id>?v=…`) weitergeben – alte oder
 * manipulierte `user.image`-Werte (fremde URLs) sollen nicht als Bild eingebettet werden.
 */
function directoryAvatar(id: string, image: string | null): string | null {
	if (!image) return null;
	const base = `/avatar/${encodeURIComponent(id)}`;
	return image === base || image.startsWith(`${base}?`) ? image : null;
}
