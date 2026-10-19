import { allDefinitions } from '$lib/server/core/modules/registry';
import { listRoles } from '$lib/server/core/permissions/roles';
import { listPermissions } from '$lib/server/core/permissions/service';
import { requirePerm } from '../settings/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.roles.view');
	const [permissions, roles] = await Promise.all([listPermissions(), listRoles(locals.ctx)]);
	const moduleNames: Record<string, string> = { core: 'Core' };
	for (const d of allDefinitions()) moduleNames[d.manifest.id] = d.manifest.name;
	return {
		moduleNames,
		permissions: permissions.map((p) => ({
			key: p.key,
			moduleId: p.moduleId,
			description: p.description,
			roles: roles.filter((r) => r.permissions.includes(p.key)).map((r) => r.name)
		}))
	};
};
