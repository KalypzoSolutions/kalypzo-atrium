import { error, fail, type Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '$lib/i18n';
import {
	createUser,
	deleteUser,
	getUser,
	listUserIds,
	listUsers,
	setUserActive,
	updateUserFull,
	verifyUserEmail
} from '$lib/server/core/auth/users';
import { BULK_USER_ACTIONS, bulkUserAction } from '$lib/server/core/auth/admin/bulk';
import { sendInvitation } from '$lib/server/core/auth/admin/password';
import { parseUserFilter } from './filter';
import { AVATAR_MAX_BYTES, removeUserAvatar, setUserAvatar } from '$lib/server/core/auth/profile';
import { canManageUser } from '$lib/server/core/auth/manage-guard';
import { isCoreError } from '$lib/server/core/errors';
import { resolvePageSize } from '$lib/server/core/settings/user-prefs';
import { enabledModuleIds } from '$lib/server/core/modules/state';
import { listRoles } from '$lib/server/core/permissions/roles';
import {
	canGrantPermission,
	isAdministrator,
	isPrivilegedPermission,
	listPermissions
} from '$lib/server/core/permissions/service';
import type { PageServerLoad } from './$types';

const DEFAULT_PAGE_SIZE = 20;

function toFail(e: unknown) {
	if (isCoreError(e)) return fail(e.status, { message: e.message });
	throw e;
}

function invalid(err: z.ZodError) {
	return fail(422, { message: err.issues.map((i) => i.message).join('; ') });
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.ctx.permissions.has('core.users.view'))
		throw error(403, t('admin-users.server.forbidden'));
	const PAGE_SIZE = await resolvePageSize(locals, DEFAULT_PAGE_SIZE);
	const filter = parseUserFilter(url.searchParams);
	const search = filter.search ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
	const { items, total } = await listUsers(locals.ctx, {
		...filter,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE
	});
	// `?edit=<id>` (von der Detailseite): Konto auch bearbeiten, wenn es nicht in der Trefferliste steht
	const editId = url.searchParams.get('edit');
	const editExtra =
		editId && !items.some((u) => u.id === editId)
			? await getUser(locals.ctx, editId).catch(() => null)
			: null;
	const canSeeRoles = locals.ctx.permissions.has('core.roles.view');
	const roles = canSeeRoles ? await listRoles(locals.ctx) : [];
	// Einzelrechte vergibt, wer Rollen zuweisen darf (gleiche Regeln: nur eigene, admin-gleiche nur als Admin)
	const permissions = locals.ctx.permissions.has('core.roles.assign')
		? await listPermissions()
		: [];
	// Konten mit Rechten, die man selbst nicht hat, sind gesperrt (nur Anzeige; der Server prüft selbst)
	const users = [];
	for (const u of items) users.push({ ...u, manageable: await canManageUser(locals.ctx, u.id) });
	const editExtraUser = editExtra
		? { ...editExtra, manageable: await canManageUser(locals.ctx, editExtra.id) }
		: null;
	return {
		users,
		total,
		page,
		pageSize: PAGE_SIZE,
		search,
		filter: {
			status: filter.status ?? null,
			twoFactor: filter.twoFactor === undefined ? null : filter.twoFactor ? 'on' : 'off',
			roleIds: filter.roleIds ?? [],
			admins: !!filter.admins,
			sort: filter.sort ?? 'name'
		},
		/** Konto aus `?edit=`, das nicht zur Trefferliste gehört (nur für den Dialog) */
		editExtraUser,
		roles: roles.map((r) => ({
			id: r.id,
			name: r.name,
			// Nur Rollen, deren Rechte der Benutzer selbst besitzt, sind zuweisbar
			assignable: r.permissions.every((p) => locals.ctx.permissions.has(p))
		})),
		permissions: permissions.map((p) => ({
			key: p.key,
			moduleId: p.moduleId,
			description: p.description,
			grantable: canGrantPermission(locals.ctx, p.key),
			privileged: isPrivilegedPermission(p.key)
		})),
		isAdministrator: isAdministrator(locals.ctx),
		can: {
			impersonate: locals.ctx.permissions.has('core.users.impersonate'),
			create: locals.ctx.permissions.has('core.users.create'),
			edit: locals.ctx.permissions.has('core.users.edit'),
			delete: locals.ctx.permissions.has('core.users.delete'),
			assign: locals.ctx.permissions.has('core.roles.assign')
		},
		selfId: locals.user?.id ?? null,
		/** Für `userAdminSections` der Module (`+page.ts`) */
		activeModules: [...(await enabledModuleIds())].sort(),
		ownPermissions: [...locals.ctx.permissions].sort()
	};
};

// Schemas je Aufruf bauen, damit die Fehlertexte in der Sprache des Requests erscheinen
const createSchema = () =>
	z.object({
		name: z.string().trim().min(1, t('admin-users.server.nameRequired')).max(100),
		email: z.string().trim().email(t('admin-users.server.invalidEmail')).max(255),
		password: z.string().max(128),
		invite: z.boolean(),
		roleIds: z.array(z.string()).max(50),
		permissionKeys: z.array(z.string()).max(500)
	});

const updateSchema = () =>
	z.object({
		id: z.string().min(1),
		name: z.string().trim().min(1, t('admin-users.server.nameRequired')).max(100),
		email: z.string().trim().email(t('admin-users.server.invalidEmail')).max(255)
	});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = createSchema().safeParse({
			name: fd.get('name'),
			email: fd.get('email'),
			password: String(fd.get('password') ?? ''),
			invite: fd.get('invite') === 'on' || fd.get('invite') === '1',
			roleIds: fd.getAll('roleIds').map(String),
			permissionKeys: fd.getAll('permissionKeys').map(String)
		});
		if (!parsed.success) return invalid(parsed.error);
		if (!parsed.data.invite && parsed.data.password.length < 12) {
			return fail(422, { message: t('admin-users.server.passwordMin') });
		}
		let id: string;
		try {
			id = await createUser(locals.ctx, parsed.data);
		} catch (e) {
			return toFail(e);
		}
		if (!parsed.data.invite) return { success: true, message: t('admin-users.server.created') };
		try {
			await sendInvitation(locals.ctx, id);
			return { success: true, message: t('admin-users.server.invited') };
		} catch (e) {
			// Konto bleibt; Einladung später auf der Detailseite erneut senden oder Link kopieren
			if (!isCoreError(e)) throw e;
			return {
				success: true,
				warning: true,
				message: t('admin-users.server.createdInviteFailed', { reason: e.message })
			};
		}
	},

	/** IDs aller Treffer des aktuellen Filters (für „Alle Treffer auswählen“) */
	allIds: async ({ request, locals }) => {
		const fd = await request.formData();
		const params = new URLSearchParams(String(fd.get('query') ?? ''));
		try {
			return { ids: await listUserIds(locals.ctx, parseUserFilter(params)) };
		} catch (e) {
			return toFail(e);
		}
	},

	bulk: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = z
			.object({
				action: z.enum(BULK_USER_ACTIONS),
				ids: z.array(z.string().min(1).max(64)).min(1).max(500),
				roleId: z.string().max(64).optional()
			})
			.safeParse({
				action: fd.get('action'),
				ids: fd.getAll('ids').map(String),
				roleId: fd.get('roleId') ? String(fd.get('roleId')) : undefined
			});
		if (!parsed.success) return invalid(parsed.error);
		try {
			const res = await bulkUserAction(locals.ctx, parsed.data.ids, parsed.data.action, {
				roleId: parsed.data.roleId
			});
			return {
				success: true,
				skipped: res.skipped,
				message: res.skipped.length
					? t('admin-users.bulk.partial', { ok: res.ok, skipped: res.skipped.length })
					: t('admin-users.bulk.done', { count: res.ok })
			};
		} catch (e) {
			return toFail(e);
		}
	},

	update: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = updateSchema().safeParse({
			id: fd.get('id'),
			name: fd.get('name'),
			email: fd.get('email')
		});
		if (!parsed.success) return invalid(parsed.error);
		try {
			// atomar: scheitert die Rollenänderung, bleiben auch Name/E-Mail unverändert (#72, 06-08)
			await updateUserFull(locals.ctx, parsed.data.id, {
				name: parsed.data.name,
				email: parsed.data.email,
				roleIds: fd.get('rolesIncluded') === '1' ? fd.getAll('roleIds').map(String) : undefined,
				permissionKeys:
					fd.get('permissionsIncluded') === '1'
						? fd.getAll('permissionKeys').map(String)
						: undefined
			});
			return { success: true, message: t('admin-users.server.saved') };
		} catch (e) {
			return toFail(e);
		}
	},

	setActive: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = z
			.object({ id: z.string().min(1), active: z.enum(['true', 'false']) })
			.safeParse({ id: fd.get('id'), active: fd.get('active') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await setUserActive(locals.ctx, parsed.data.id, parsed.data.active === 'true');
			return {
				success: true,
				message:
					parsed.data.active === 'true'
						? t('admin-users.server.activated')
						: t('admin-users.server.deactivated')
			};
		} catch (e) {
			return toFail(e);
		}
	},

	verifyEmail: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = z.object({ id: z.string().min(1) }).safeParse({ id: fd.get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await verifyUserEmail(locals.ctx, parsed.data.id);
			return { success: true, message: t('admin-users.server.emailVerified') };
		} catch (e) {
			return toFail(e);
		}
	},

	setAvatar: async ({ request, locals }) => {
		const fd = await request.formData();
		const id = fd.get('id');
		const file = fd.get('avatar');
		if (typeof id !== 'string' || !id)
			return fail(422, { message: t('admin-users.server.userMissing') });
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { message: t('admin-users.server.chooseImage') });
		}
		// Größe vor dem Einlesen prüfen (kein Puffern überlanger Uploads)
		if (file.size > AVATAR_MAX_BYTES) {
			return fail(413, { message: t('admin-users.server.imageTooLarge') });
		}
		try {
			await setUserAvatar(locals.ctx, id, {
				data: new Uint8Array(await file.arrayBuffer()),
				contentType: file.type
			});
			return { success: true, message: t('admin-users.server.avatarSaved') };
		} catch (e) {
			return toFail(e);
		}
	},

	removeAvatar: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = z.object({ id: z.string().min(1) }).safeParse({ id: fd.get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await removeUserAvatar(locals.ctx, parsed.data.id);
			return { success: true, message: t('admin-users.server.avatarRemoved') };
		} catch (e) {
			return toFail(e);
		}
	},

	delete: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = z.object({ id: z.string().min(1) }).safeParse({ id: fd.get('id') });
		if (!parsed.success) return invalid(parsed.error);
		try {
			await deleteUser(locals.ctx, parsed.data.id);
			return { success: true, message: t('admin-users.server.deleted') };
		} catch (e) {
			return toFail(e);
		}
	}
};
