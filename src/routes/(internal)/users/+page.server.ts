import { error, fail, type Actions } from '@sveltejs/kit';
import { z } from 'zod';
import {
	createUser,
	deleteUser,
	listUsers,
	setUserActive,
	setUserRoles,
	updateUser
} from '$lib/server/core/auth/users';
import { isCoreError } from '$lib/server/core/errors';
import { resolvePageSize } from '$lib/server/core/settings/user-prefs';
import { listRoles } from '$lib/server/core/permissions/roles';
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
	if (!locals.ctx.permissions.has('core.users.view')) throw error(403, 'Keine Berechtigung');
	const PAGE_SIZE = await resolvePageSize(locals, DEFAULT_PAGE_SIZE);
	const search = url.searchParams.get('q')?.trim() ?? '';
	const page = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1);
	const { items, total } = await listUsers(locals.ctx, {
		search: search || undefined,
		limit: PAGE_SIZE,
		offset: (page - 1) * PAGE_SIZE
	});
	const canSeeRoles = locals.ctx.permissions.has('core.roles.view');
	const roles = canSeeRoles ? await listRoles(locals.ctx) : [];
	return {
		users: items,
		total,
		page,
		pageSize: PAGE_SIZE,
		search,
		roles: roles.map((r) => ({
			id: r.id,
			name: r.name,
			// Nur Rollen, deren Rechte der Benutzer selbst besitzt, sind zuweisbar
			assignable: r.permissions.every((p) => locals.ctx.permissions.has(p))
		})),
		can: {
			create: locals.ctx.permissions.has('core.users.create'),
			edit: locals.ctx.permissions.has('core.users.edit'),
			delete: locals.ctx.permissions.has('core.users.delete'),
			assign: locals.ctx.permissions.has('core.roles.assign')
		},
		selfId: locals.user?.id ?? null
	};
};

const createSchema = z.object({
	name: z.string().trim().min(1, 'Name ist erforderlich').max(100),
	email: z.string().trim().email('Ungültige E-Mail-Adresse').max(255),
	password: z.string().min(12, 'Passwort muss mindestens 12 Zeichen lang sein').max(128),
	roleIds: z.array(z.string()).max(50)
});

const updateSchema = z.object({
	id: z.string().min(1),
	name: z.string().trim().min(1, 'Name ist erforderlich').max(100),
	email: z.string().trim().email('Ungültige E-Mail-Adresse').max(255)
});

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = createSchema.safeParse({
			name: fd.get('name'),
			email: fd.get('email'),
			password: fd.get('password'),
			roleIds: fd.getAll('roleIds').map(String)
		});
		if (!parsed.success) return invalid(parsed.error);
		try {
			await createUser(locals.ctx, parsed.data);
			return { success: true, message: 'Benutzer angelegt' };
		} catch (e) {
			return toFail(e);
		}
	},

	update: async ({ request, locals }) => {
		const fd = await request.formData();
		const parsed = updateSchema.safeParse({
			id: fd.get('id'),
			name: fd.get('name'),
			email: fd.get('email')
		});
		if (!parsed.success) return invalid(parsed.error);
		try {
			await updateUser(locals.ctx, parsed.data.id, {
				name: parsed.data.name,
				email: parsed.data.email
			});
			if (fd.get('rolesIncluded') === '1') {
				await setUserRoles(locals.ctx, parsed.data.id, fd.getAll('roleIds').map(String));
			}
			return { success: true, message: 'Benutzer gespeichert' };
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
				message: parsed.data.active === 'true' ? 'Benutzer aktiviert' : 'Benutzer deaktiviert'
			};
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
			return { success: true, message: 'Benutzer gelöscht' };
		} catch (e) {
			return toFail(e);
		}
	}
};
