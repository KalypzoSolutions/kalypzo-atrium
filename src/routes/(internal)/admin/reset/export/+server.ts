import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { BACKUP_FILE_EXT, BACKUP_MIN_PASSWORD } from '$lib/backup/contract';
import { isCoreError } from '$lib/server/core/errors';
import { safeFileName as cleanFileName } from '$lib/sdk/file-names';
import { exportResetData } from '$lib/server/core/system/reset';
import type { RequestHandler } from './$types';
import { t } from '$lib/i18n';

/**
 * Sicherung vor dem Zurücksetzen: POST JSON `{ token, password, totp?, backupPassword }` → verschlüsselte
 * Sicherung (`.atriumbackup`, Format der Datensicherung) als Download; die Temp-Datei wird nach dem Senden gelöscht.
 * JSON-POSTs fallen nicht unter den Origin-Check von SvelteKit (nur Formular-Content-Types) –
 * daher hier eigener Same-Origin-Check.
 */
const bodySchema = z
	.object({
		token: z.string().min(1).max(500),
		password: z
			.string()
			.min(1, { error: () => t('admin-reset.server.password') })
			.max(1024),
		backupPassword: z
			.string()
			.min(BACKUP_MIN_PASSWORD, {
				error: () => t('admin-reset.server.backupPasswordMin', { count: BACKUP_MIN_PASSWORD })
			})
			.max(200),
		totp: z
			.string()
			.regex(/^\d{6}$/, { error: () => t('admin-reset.server.totp') })
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
	const cleaned = cleanFileName(name, {
		replacement: '-',
		maxLength: 200,
		fallback: 'atrium-reset'
	});
	return cleaned + (cleaned.endsWith(BACKUP_FILE_EXT) ? '' : BACKUP_FILE_EXT);
}

export const POST: RequestHandler = async ({ request, locals, url }) => {
	if (!locals.user) return problem(401, t('admin-reset.server.unauthenticated'));
	if (!locals.ctx.permissions.has('core.system.reset'))
		return problem(403, t('admin-reset.server.forbidden'));

	const origin = request.headers.get('origin');
	if (!origin || origin !== url.origin) return problem(403, t('admin-reset.server.badOrigin'));
	if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
		return problem(415, t('admin-reset.server.expectedJson'));
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return problem(400, t('admin-reset.server.invalidJson'));
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
		const exp = await exportResetData(locals.ctx, parsed.data);
		// Temp-Datei genau einmal freigeben – nach vollständigem Senden, Fehler oder Abbruch
		let finished = false;
		const finish = () => {
			if (finished) return;
			finished = true;
			void exp.done().catch(() => {});
		};
		const file = createReadStream(exp.path);
		file.once('close', finish);
		file.once('error', finish);
		request.signal.addEventListener('abort', () => file.destroy(), { once: true });
		const body = Readable.toWeb(file) as unknown as ReadableStream<Uint8Array>;
		return new Response(body, {
			status: 200,
			headers: {
				'content-type': 'application/octet-stream',
				'content-disposition': `attachment; filename="${safeFileName(exp.fileName)}"`,
				'content-length': String(exp.size),
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if (isCoreError(e)) return problem(e.status, coreMessage(e), e.details ?? null);
		throw e;
	}
};
