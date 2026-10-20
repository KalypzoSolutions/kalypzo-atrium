import { analyzeInput } from '$lib/backup/contract';
import { analyzeBackup } from '$lib/server/core/backup/restore';
import { failure, guard, ok, readJson } from '../../http.server';
import type { RequestHandler } from './$types';

/** Sicherung entschlüsseln und prüfen: POST JSON `AnalyzeInput` → `RestorePreview`. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const denied = guard(request, locals, url, { write: true, contentType: 'application/json' });
	if (denied) return denied;
	const body = await readJson(request, analyzeInput);
	if (!body.ok) return body.response;
	try {
		return ok(await analyzeBackup(locals.ctx, body.data));
	} catch (e) {
		return failure(e);
	}
};
