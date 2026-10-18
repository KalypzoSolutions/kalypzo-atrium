import { error, fail } from '@sveltejs/kit';
import type { z } from 'zod';
import { isCoreError } from '$lib/server/core/errors';

/** 403, wenn dem Benutzer die Berechtigung fehlt (zusätzlich zur Prüfung in den Services). */
export function requirePerm(locals: App.Locals, key: string): void {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	if (!locals.ctx.permissions.has(key)) throw error(403, 'Keine Berechtigung');
}

export function toFail(e: unknown) {
	if (isCoreError(e)) return fail(e.status, { message: e.message });
	throw e;
}

export function invalid(err: z.ZodError) {
	return fail(422, { message: err.issues.map((i) => i.message).join('; ') });
}
