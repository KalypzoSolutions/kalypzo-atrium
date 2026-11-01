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

/** Wie `toFail`, aber mit Feldfehlern (`fields.password`, `fields.confirmId` …) aus Validierungsdetails */
export function failWithFields(e: unknown) {
	if (!isCoreError(e)) throw e;
	const details = Array.isArray(e.details)
		? (e.details as { path?: (string | number)[]; message?: string }[])
		: [];
	const fields: Record<string, string> = {};
	for (const d of details) {
		if (d.path?.[0] !== undefined) fields[String(d.path[0])] = d.message ?? '';
	}
	const message = details.length ? details.map((d) => d.message).join('; ') : e.message;
	return fail(e.status, { message, fields });
}

export function invalid(err: z.ZodError) {
	return fail(422, { message: err.issues.map((i) => i.message).join('; ') });
}
