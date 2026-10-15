import { navigationFor } from '$lib/server/core/modules/service';
import { getSetting } from '$lib/server/core/settings/service';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const [systemName, accentColor] = await Promise.all([
		getSetting<string>('core.system.name'),
		getSetting<string>('core.design.accentColor')
	]);
	const navigation = locals.user ? await navigationFor(locals.ctx) : [];
	return {
		user: locals.user,
		permissions: [...locals.ctx.permissions].sort(),
		navigation,
		systemName,
		accentColor
	};
};
