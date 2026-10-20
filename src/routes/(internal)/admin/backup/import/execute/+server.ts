import { executeInput } from '$lib/backup/contract';
import { executeRestore } from '$lib/server/core/backup/restore';
import { failure, guard, ok, readJson } from '../../http.server';
import type { RequestHandler } from './$types';

/** Wiederherstellung starten: POST JSON `ExecuteInput` → 202 `{ runId }` (Stand per GET status). */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const denied = guard(request, locals, url, { write: true, contentType: 'application/json' });
	if (denied) return denied;
	const body = await readJson(request, executeInput);
	if (!body.ok) return body.response;
	try {
		const run = await executeRestore(locals.ctx, body.data);
		return ok({ runId: run.runId }, 202);
	} catch (e) {
		return failure(e);
	}
};
