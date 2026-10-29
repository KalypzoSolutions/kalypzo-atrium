import { loadInternalLayout } from '$lib/server/core/internal-pages';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => loadInternalLayout(event);
