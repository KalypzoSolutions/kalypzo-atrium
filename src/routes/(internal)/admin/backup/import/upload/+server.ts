import { uploadCreateInput } from '$lib/backup/contract';
import { createUpload } from '$lib/server/core/backup/restore';
import { failure, guard, ok, readJson } from '../../http.server';
import type { RequestHandler } from './$types';

/** Upload anlegen: POST JSON `{ size, fileName? }` → `UploadCreated`. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const denied = guard(request, locals, url, { write: true, contentType: 'application/json' });
	if (denied) return denied;
	const body = await readJson(request, uploadCreateInput);
	if (!body.ok) return body.response;
	try {
		return ok(await createUpload(locals.ctx, body.data), 201);
	} catch (e) {
		return failure(e);
	}
};
