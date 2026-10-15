import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { isCoreError } from '$lib/server/core/errors';
import { renderTemplatePreview } from '$lib/server/core/pdf';
import type { RequestHandler } from './$types';

const id = z.string().regex(/^[a-z0-9-]{1,40}$/);

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Nicht angemeldet');
	if (!locals.ctx.permissions.has('core.pdf.manage')) throw error(403, 'Keine Berechtigung');
	const template = id.safeParse(url.searchParams.get('template'));
	if (!template.success) throw error(400, 'Ungueltige Vorlage');
	const onlyRaw = url.searchParams.get('only');
	const only = onlyRaw === null ? undefined : id.safeParse(onlyRaw);
	if (only && !only.success) throw error(400, 'Ungueltiger Bestandteil');
	try {
		const png = await renderTemplatePreview({
			template: template.data,
			only: only?.success ? only.data : undefined
		});
		return new Response(Buffer.from(png), {
			headers: { 'content-type': 'image/png', 'cache-control': 'no-store' }
		});
	} catch (e) {
		if (isCoreError(e)) throw error(e.status, e.message);
		throw e;
	}
};
