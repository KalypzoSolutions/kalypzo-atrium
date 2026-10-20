import { enabledModuleIds } from '$lib/server/core/modules/state';
import { getDefinition, getSetting } from '$lib/server/core/settings/service';
import type { DashboardLayoutPref } from '$lib/sdk/client/dashboard-widgets';
import type { PageServerLoad } from './$types';

/**
 * Das Dashboard besteht aus Kacheln (Core + Module, siehe `+page.ts`), die ihre Daten selbst laden.
 * Hier nur die aktiven Module und die gespeicherte Anordnung des Benutzers.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const [enabled, stored] = await Promise.all([
		enabledModuleIds(),
		getSetting<unknown>('core.user.dashboard', locals.user!.id)
	]);
	// Ungültige (z. B. veraltete) Werte fallen still auf den Standard zurück
	const parsed = getDefinition('core.user.dashboard').schema.safeParse(stored);
	return {
		activeModules: [...enabled].sort(),
		layout: parsed.success ? (parsed.data as DashboardLayoutPref | null) : null
	};
};
