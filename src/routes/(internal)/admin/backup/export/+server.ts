import { exportInput } from '$lib/backup/contract';
import { startBackupExport } from '$lib/server/core/backup/export';
import { failure, guard, ok, readJson } from '../http.server';
import type { RequestHandler } from './$types';

/** Sicherung erstellen: POST JSON `ExportInput` → `ExportResult` (Download danach per GET). */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const denied = guard(request, locals, url, { write: true, contentType: 'application/json' });
	if (denied) return denied;
	const body = await readJson(request, exportInput);
	if (!body.ok) return body.response;
	try {
		return ok(await startBackupExport(locals.ctx, body.data));
	} catch (e) {
		return failure(e);
	}
};
