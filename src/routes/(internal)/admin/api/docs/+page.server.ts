import { buildApiCatalog } from '$lib/server/core/api/catalog';
import { initCore } from '$lib/server/core/init';
import { requirePerm } from '../../_shared/server-utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requirePerm(locals, 'core.api.view');
	// Wie /api/v1: stellt sicher, dass Core-API und Module registriert sind (idempotent).
	await initCore();
	return { catalog: await buildApiCatalog(locals.ctx) };
};
