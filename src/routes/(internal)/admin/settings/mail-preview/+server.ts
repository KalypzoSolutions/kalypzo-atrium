import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import {
	loadMailLayoutOptions,
	renderMailLayout,
	sampleMailText
} from '$lib/server/core/mail-layout';
import type { RequestHandler } from './$types';

/** Vorschau des E-Mail-Layouts mit den gespeicherten Einstellungen (Recht `core.settings.view`). */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, t('admin-mail.errors.unauthenticated'));
	if (!locals.ctx.permissions.has('core.settings.view'))
		throw error(403, t('admin-mail.errors.forbidden'));
	const options = await loadMailLayoutOptions();
	const { html } = renderMailLayout({ text: sampleMailText() }, options, 'data');
	return new Response(html, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-store',
			// Reines HTML mit Inline-Styles und data:-Bildern, nur von der eigenen Seite einbettbar
			'content-security-policy':
				"default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'self'"
		}
	});
};
