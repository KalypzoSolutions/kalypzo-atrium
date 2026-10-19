import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { isCoreError } from '$lib/server/core/errors';
import { exportResetData } from '$lib/server/core/system/reset';
import type { RequestHandler } from './$types';

/**
 * Sicherung vor dem Zurücksetzen: POST JSON `{ token, password, totp? }` → JSON-Datei als Download.
 * JSON-POSTs fallen nicht unter den Origin-Check von SvelteKit (nur Formular-Content-Types) –
 * daher hier eigener Same-Origin-Check.
 */
const bodySchema = z
	.object({
		token: z.string().min(1).max(500),
		password: z.string().min(1, 'Bitte das Passwort eingeben').max(1024),
		totp: z
			.string()
			.regex(/^\d{6}$/, 'Bitte den 6-stelligen Code eingeben')
			.optional()
	})
	.strict();

function problem(status: number, message: string, details: unknown = null) {
	return json({ message, details }, { status, headers: { 'cache-control': 'no-store' } });
}

/** Bei Validierungsfehlern die Feldmeldungen (z. B. „Passwort ist nicht korrekt“) statt des Sammeltexts. */
function coreMessage(e: { message: string; details?: unknown }): string {
	if (Array.isArray(e.details)) {
		const msgs = e.details
			.map((d) => (d && typeof d === 'object' ? (d as { message?: unknown }).message : null))
			.filter((m): m is string => typeof m === 'string' && m.length > 0);
		if (msgs.length) return msgs.join('; ');
	}
	return e.message;
}

/** Dateiname für content-disposition: nur sichere ASCII-Zeichen. */
function safeFileName(name: string): string {
	const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
	return (cleaned || 'ep-intern-sicherung') + (cleaned.endsWith('.json') ? '' : '.json');
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) return problem(401, 'Nicht angemeldet');
	if (!locals.ctx.permissions.has('core.system.reset')) return problem(403, 'Keine Berechtigung');

	const origin = request.headers.get('origin');
	if (!origin || origin !== url.origin) return problem(403, 'Ungültige Herkunft der Anfrage');
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return problem(415, 'Erwartet application/json');
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return problem(400, 'Ungültiges JSON');
	}
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		return problem(
			422,
			parsed.error.issues.map((i) => i.message).join('; '),
			parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
		);
	}

	try {
		const { fileName, json: body } = await exportResetData(locals.ctx, parsed.data);
		return new Response(body, {
			status: 200,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="${safeFileName(fileName)}"`,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if (isCoreError(e)) return problem(e.status, coreMessage(e), e.details ?? null);
		throw e;
	}
};
