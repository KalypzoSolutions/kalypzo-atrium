import { redirect } from '@sveltejs/kit';
import { stopImpersonation } from '$lib/server/core/auth/admin/impersonation';
import type { RequestHandler } from './$types';

/**
 * Beendet „Als Person handeln“ der aktuellen Sitzung (Knopf im Banner) und führt zurück zur Detailseite der Person.
 * Ohne laufendes Handeln einfach zurück zur Benutzerliste. Formular-POST (Origin-Check von SvelteKit).
 */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.sessionId || !locals.impersonation) throw redirect(303, '/admin/users');
	const target = await stopImpersonation(locals.sessionId, locals.ctx);
	throw redirect(303, target ? `/admin/users/${encodeURIComponent(target)}` : '/admin/users');
};
