import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { z } from 'zod';
import { isCoreError } from '$lib/server/core/errors';
import { generate } from '$lib/server/core/pdf';
import { sampleContent, sampleRecipient } from '$lib/server/core/pdf/sample';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, t('admin-pdf.errors.unauthenticated'));
	if (!locals.ctx.permissions.has('core.pdf.manage'))
		throw error(403, t('admin-pdf.errors.forbidden'));
	const template = z
		.string()
		.regex(/^[a-z0-9-]{1,40}$/)
		.catch('default')
		.parse(url.searchParams.get('template') ?? 'default');
	try {
		const pdf = await generate(locals.ctx, {
			template,
			title: t('admin-pdf.testDocumentTitle'),
			module: 'core',
			recipient: sampleRecipient(),
			content: sampleContent()
		});
		return new Response(Buffer.from(pdf.buffer), {
			headers: {
				'content-type': pdf.contentType,
				'content-disposition': `attachment; filename="${pdf.fileName}"`,
				'cache-control': 'no-store'
			}
		});
	} catch (e) {
		if (isCoreError(e)) throw error(e.status, e.message);
		throw e;
	}
};
