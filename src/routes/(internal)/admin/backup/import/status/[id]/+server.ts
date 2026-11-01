import { restoreStatus } from '$lib/server/core/backup/restore';
import { failure, guard, ok, problem } from '../../../http.server';
import type { RequestHandler } from './$types';
import { t } from '$lib/i18n';

/** Stand eines Wiederherstellungslaufs: GET → `RunStatus`. */
export const GET: RequestHandler = async ({ request, locals, url, params }) => {
	const denied = guard(request, locals, url);
	if (denied) return denied;
	if (!/^[A-Za-z0-9_-]{10,100}$/.test(params.id))
		return problem(404, t('admin-backup.http.notFound'));
	try {
		return ok(await restoreStatus(locals.ctx, params.id));
	} catch (e) {
		return failure(e);
	}
};
