import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { BACKUP_FILE_EXT } from '$lib/backup/contract';
import { takeBackupDownload } from '$lib/server/core/backup/export';
import { failure, guard, problem, safeFileName } from '../../http.server';
import type { RequestHandler } from './$types';

/** Einmaliger Download der erstellten Sicherung (`/admin/backup/export/<downloadId>`). */
export const GET: RequestHandler = async ({ request, locals, url, params }) => {
	const denied = guard(request, locals, url);
	if (denied) return denied;
	if (!/^[A-Za-z0-9_-]{10,100}$/.test(params.id)) return problem(404, 'Nicht gefunden');

	let download: Awaited<ReturnType<typeof takeBackupDownload>>;
	try {
		download = await takeBackupDownload(locals.ctx, params.id);
	} catch (e) {
		return failure(e);
	}

	// Temp-Datei genau einmal freigeben – nach vollständigem Senden, Fehler oder Abbruch
	let finished = false;
	const finish = () => {
		if (finished) return;
		finished = true;
		void Promise.resolve()
			.then(() => download.done())
			.catch(() => {});
	};

	const file = createReadStream(download.path);
	file.once('close', finish);
	file.once('error', finish);
	request.signal.addEventListener('abort', () => file.destroy(), { once: true });
	const body = Readable.toWeb(file) as unknown as ReadableStream<Uint8Array>;

	return new Response(body, {
		status: 200,
		headers: {
			'content-type': 'application/octet-stream',
			'content-disposition': `attachment; filename="${safeFileName(download.fileName, BACKUP_FILE_EXT)}"`,
			'content-length': String(download.size),
			'cache-control': 'no-store',
			'x-content-type-options': 'nosniff'
		}
	});
};
