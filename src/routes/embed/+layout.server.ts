import { loadInternalLayout } from '$lib/server/core/internal-pages';
import type { LayoutServerLoad } from './$types';

/** Embed-Seiten (`/embed/<modul>/…`, im iframe): Login und Theme wie im `(internal)`-Layout */
export const load: LayoutServerLoad = (event) => loadInternalLayout(event);
