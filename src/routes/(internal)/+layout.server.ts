import { loadInternalLayout } from '$lib/server/core/internal-pages';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => ({
	...(await loadInternalLayout(event)),
	// Seitenleiste eingeklappt (je Gerät, Cookie wie beim Theme), damit SSR ohne Springen rendert
	sidebarCollapsed: event.cookies.get('sidebar') === 'collapsed'
});
