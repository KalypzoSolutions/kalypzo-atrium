/**
 * Download der Datenauskunft als JSON (Art. 15/20 DSGVO). Nur per Formular-POST (SvelteKit-Origin-Check),
 * Recht `core.privacy.export`; Antwort ohne Caching.
 */
import { error } from '@sveltejs/kit';
import { isCoreError } from '$lib/server/core/errors';
import { exportSubject, PRIVACY_PERMISSION } from '$lib/server/core/privacy/service';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	if (!locals.ctx.permissions.has(PRIVACY_PERMISSION)) throw error(403, 'Keine Berechtigung');
	const form = await request.formData();
	const userId = String(form.get('userId') ?? '').trim() || null;
	const memberId = String(form.get('memberId') ?? '').trim() || null;
	try {
		const result = await exportSubject(locals.ctx, { userId, memberId });
		const stamp = result.generatedAt.slice(0, 10);
		return new Response(JSON.stringify(result, null, 2), {
			status: 200,
			headers: {
				'content-type': 'application/json; charset=utf-8',
				'content-disposition': `attachment; filename="datenauskunft-${stamp}.json"`,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if (isCoreError(e)) throw error(e.status, e.message);
		throw e;
	}
};
