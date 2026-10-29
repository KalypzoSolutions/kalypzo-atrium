import { guardModulePage } from '$lib/server/core/internal-pages';
import type { PageServerLoad } from './$types';

/** Guard wie `/modules/<id>/…`: Modul aktiv, mindestens ein Modulrecht */
export const load: PageServerLoad = ({ params, locals }) => guardModulePage(params, locals);
