import type { Actions } from '@sveltejs/kit';
import { z } from 'zod';
import { createRole, deleteRole, listRoles, updateRole } from '$lib/server/core/permissions/roles';
import { listPermissions } from '$lib/server/core/permissions/service';
import { invalid, requirePerm, toFail } from '../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.roles.view');
	const [roles, permissions] = await Promise.all([listRoles(locals.ctx), listPermissions()]);
	const mine = locals.ctx.permissions;
	return {
		roles,
		permissions: permissions.map((p) => ({
			key: p.key,
			moduleId: p.moduleId,
			description: p.description,
			grantable: mine.has(p.key)
		})),
		can: {
			create: mine.has('core.roles.create'),
			edit: mine.has('core.roles.edit'),
			delete: mine.has('core.roles.delete')
		}
	};
};

const base = z.object({
	name: z.string().trim().min(2, 'Name muss mindestens 2 Zeichen lang sein').max(60),
	description: z.string().trim().max(300),
	permissions: z.array(z.string()).max(500)
});

function readForm(fd: FormData) {
	return base.safeParse({
		name: fd.get('name'),
		description: fd.get('description') ?? '',
		permissions: fd.getAll('permissions').map(String)
	});
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const parsed = readForm(await request.formData());
		if (!parsed.success) return invalid(parsed.error);
		try {
			await createRole(locals.ctx, parsed.data);
			return { success: true, message: 'Rolle angelegt' };
		} catch (e) {
			return toFail(e);
		}
	},
	update: async ({ request, locals }) => {
		const fd = await request.formData();
		const id = z.string().min(1).safeParse(fd.get('id'));
		if (!id.success) return invalid(id.error);
		const parsed = readForm(fd);
		if (!parsed.success) return invalid(parsed.error);
		try {
			await updateRole(locals.ctx, id.data, parsed.data);
			return { success: true, message: 'Rolle gespeichert' };
		} catch (e) {
			return toFail(e);
		}
	},
	delete: async ({ request, locals }) => {
		const id = z
			.string()
			.min(1)
			.safeParse((await request.formData()).get('id'));
		if (!id.success) return invalid(id.error);
		try {
			await deleteRole(locals.ctx, id.data);
			return { success: true, message: 'Rolle gelöscht' };
		} catch (e) {
			return toFail(e);
		}
	}
};
