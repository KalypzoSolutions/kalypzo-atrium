import { UPLOAD_CHUNK_BYTES } from '$lib/backup/contract';
import { appendUpload } from '$lib/server/core/backup/restore';
import { failure, guard, ok, problem } from '../../../http.server';
import type { RequestHandler } from './$types';

/**
 * Ein Stück der Sicherungsdatei anhängen: PUT `?offset=<n>` mit `application/octet-stream`
 * → `UploadProgress`. `offset` muss der bisher empfangenen Größe entsprechen (prüft der Service).
 */
export const PUT: RequestHandler = async ({ request, locals, url, params }) => {
	const denied = guard(request, locals, url, {
		write: true,
		contentType: 'application/octet-stream'
	});
	if (denied) return denied;
	if (!/^[A-Za-z0-9_-]{10,100}$/.test(params.id)) return problem(404, 'Nicht gefunden');

	const offsetRaw = url.searchParams.get('offset') ?? '';
	if (!/^\d{1,15}$/.test(offsetRaw)) {
		return problem(422, 'Ungültiger Offset', [{ path: 'offset', message: 'Ungültiger Offset' }]);
	}
	const lengthRaw = request.headers.get('content-length') ?? '';
	if (!/^\d{1,15}$/.test(lengthRaw)) return problem(411, 'Content-Length fehlt');
	const length = Number(lengthRaw);
	if (length <= 0 || !request.body) return problem(400, 'Leeres Stück');
	if (length > UPLOAD_CHUNK_BYTES) return problem(413, 'Stück ist zu groß');

	try {
		return ok(await appendUpload(locals.ctx, params.id, Number(offsetRaw), request.body, length));
	} catch (e) {
		return failure(e);
	}
};
