/**
 * Gemeinsame Helfer der Datensicherungs-Endpunkte unter `/admin/backup/**`.
 *
 * JSON- und Binär-Requests fallen nicht unter den Origin-Check von SvelteKit (nur Formular-Content-Types),
 * deshalb prüft jeder schreibende Endpunkt die Herkunft selbst (wie `/admin/reset/export`).
 */
import { json } from '@sveltejs/kit';
import type { z } from 'zod';
import { isCoreError } from '$lib/server/core/errors';
import { BackupFormatError } from '$lib/server/core/backup/types';

export const BACKUP_PERMISSION = 'core.system.backup';

const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const;

/** Fehlerantwort `{ message, details }` ohne Caching */
export function problem(status: number, message: string, details: unknown = null): Response {
	return json({ message, details }, { status, headers: NO_STORE });
}

/** Erfolgsantwort `{ data }` ohne Caching */
export function ok(data: unknown, status = 200): Response {
	return json({ data }, { status, headers: NO_STORE });
}

/** Bei Validierungsfehlern die Feldmeldungen (z. B. „Passwort ist nicht korrekt“) statt des Sammeltexts. */
export function coreMessage(e: { message: string; details?: unknown }): string {
	if (Array.isArray(e.details)) {
		const msgs = e.details
			.map((d) => (d && typeof d === 'object' ? (d as { message?: unknown }).message : null))
			.filter((m): m is string => typeof m === 'string' && m.length > 0);
		if (msgs.length) return msgs.join('; ');
	}
	return e.message;
}

/** Dateiname für content-disposition: nur sichere ASCII-Zeichen. */
export function safeFileName(name: string, ext: string): string {
	const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	return (cleaned || 'ep-intern-sicherung') + (cleaned.endsWith(ext) ? '' : ext);
}

interface GuardOptions {
	/** Schreibender Request: Origin muss exakt der eigenen Herkunft entsprechen */
	write?: boolean;
	/** Erwarteter Content-Type (Präfix, klein geschrieben) */
	contentType?: string;
}

/**
 * Anmeldung, Recht und Herkunft prüfen. Liefert eine Fehlerantwort oder `null`.
 * Lesende Requests (GET) senden bei Navigationen kein `Origin` – dort wird nur ein
 * websiteübergreifender Aufruf (`sec-fetch-site: cross-site`) abgewiesen.
 */
export function guard(
	request: Request,
	locals: App.Locals,
	url: URL,
	opts: GuardOptions = {}
): Response | null {
	if (!locals.user) return problem(401, 'Nicht angemeldet');
	if (!locals.ctx.permissions.has(BACKUP_PERMISSION)) return problem(403, 'Keine Berechtigung');

	if (opts.write) {
		const origin = request.headers.get('origin');
		if (!origin || origin !== url.origin) return problem(403, 'Ungültige Herkunft der Anfrage');
	} else if (request.headers.get('sec-fetch-site') === 'cross-site') {
		return problem(403, 'Ungültige Herkunft der Anfrage');
	}

	if (opts.contentType) {
		const ct = (request.headers.get('content-type') ?? '').toLowerCase();
		if (!ct.startsWith(opts.contentType)) return problem(415, `Erwartet ${opts.contentType}`);
	}
	return null;
}

/** JSON-Body lesen und strikt prüfen. */
export async function readJson<S extends z.ZodType>(
	request: Request,
	schema: S
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return { ok: false, response: problem(400, 'Ungültiges JSON') };
	}
	const parsed = schema.safeParse(raw);
	if (!parsed.success) {
		return {
			ok: false,
			response: problem(
				422,
				parsed.error.issues.map((i) => i.message).join('; '),
				parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
			)
		};
	}
	return { ok: true, data: parsed.data };
}

/** Core- und Formatfehler auf HTTP abbilden, alles andere weiterwerfen (→ 500). */
export function failure(e: unknown): Response {
	if (isCoreError(e)) return problem(e.status, coreMessage(e), e.details ?? null);
	if (e instanceof BackupFormatError) return problem(422, e.message, { code: e.code });
	throw e;
}
