import { error } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { exportUsersCsv } from '$lib/server/core/auth/admin/bulk';
import { isCoreError } from '$lib/server/core/errors';
import { parseUserFilter } from '../filter';
import type { RequestHandler } from './$types';

/** CSV der Benutzerliste mit den Filtern der Seite (höchstens 500 Zeilen). */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.ctx.permissions.has('core.users.view'))
		throw error(403, t('admin-users.server.forbidden'));
	try {
		const csv = await exportUsersCsv(locals.ctx, parseUserFilter(url.searchParams));
		const date = new Date().toISOString().slice(0, 10);
		return new Response(csv, {
			headers: {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="${t('admin-users.csv.fileName')}-${date}.csv"`
			}
		});
	} catch (e) {
		if (isCoreError(e)) throw error(e.status, e.message);
		throw e;
	}
};
