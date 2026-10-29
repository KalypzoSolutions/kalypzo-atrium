import { guardModulePage } from '$lib/server/core/internal-pages';
import type { PageServerLoad } from './$types';

/**
 * Guard für die Modul-Oberfläche: Modul muss im Build vorhanden, laufzeitseitig aktiv und
 * der Benutzer mindestens einer Modulberechtigung berechtigt sein.
 */
export const load: PageServerLoad = ({ params, locals }) => guardModulePage(params, locals);
