/**
 * Minimaler S3-Ersatz für E2E-Tests (Path-Style, ohne Signaturprüfung, nur im Arbeitsspeicher).
 *
 * Unterstützt genau das, was `core.storage` braucht: PUT (PutObject), GET/HEAD (GetObject/HeadObject),
 * DELETE (DeleteObject) und HEAD auf den Bucket (HeadBucket). Pfad: `/<bucket>/<key>`.
 * Uploads mit `content-encoding: aws-chunked` (Streaming-Prüfsummen des AWS SDK) werden entpackt.
 *
 * ```ts
 * const s3 = await startS3Mock();
 * // core.storage.endpoint = s3.endpoint, forcePathStyle = true, beliebige Zugangsdaten
 * await s3.close();
 * ```
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface S3Mock {
	/** z. B. `http://127.0.0.1:54321` */
	endpoint: string;
	/** Anzahl gespeicherter Objekte (für Prüfungen) */
	size(): number;
	close(): Promise<void>;
}

interface StoredObject {
	body: Buffer;
	type: string;
}

/** `aws-chunked`: `<hex>[;chunk-signature=…]\r\n<daten>\r\n … 0\r\n<trailer>\r\n\r\n` */
function decodeAwsChunked(raw: Buffer): Buffer {
	const parts: Buffer[] = [];
	let pos = 0;
	while (pos < raw.length) {
		const lineEnd = raw.indexOf('\r\n', pos);
		if (lineEnd < 0) break;
		const header = raw.subarray(pos, lineEnd).toString('latin1');
		const size = parseInt(header.split(';')[0]!.trim(), 16);
		if (!Number.isFinite(size) || size <= 0) break;
		const start = lineEnd + 2;
		parts.push(raw.subarray(start, start + size));
		pos = start + size + 2;
	}
	return Buffer.concat(parts);
}

const notFound = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code></Error>';

export async function startS3Mock(): Promise<S3Mock> {
	const store = new Map<string, StoredObject>();

	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
		const bucket = parts[0] ?? '';
		const key = parts.slice(1).join('/');
		const id = `${bucket}/${key}`;
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			// Bucket-Ebene (HeadBucket u. a.): immer vorhanden
			if (!key) {
				res.writeHead(200).end();
				return;
			}
			const method = req.method ?? 'GET';
			if (method === 'PUT') {
				let body: Buffer = Buffer.concat(chunks);
				const encoding = String(req.headers['content-encoding'] ?? '');
				if (encoding.includes('aws-chunked') || req.headers['x-amz-decoded-content-length']) {
					body = decodeAwsChunked(body);
				}
				store.set(id, {
					body,
					type: String(req.headers['content-type'] ?? 'application/octet-stream')
				});
				res.writeHead(200, { etag: '"e2e"' }).end();
				return;
			}
			if (method === 'GET' || method === 'HEAD') {
				const obj = store.get(id);
				if (!obj) {
					res.writeHead(404, { 'content-type': 'application/xml' });
					res.end(method === 'GET' ? notFound : undefined);
					return;
				}
				res.writeHead(200, {
					'content-type': obj.type,
					'content-length': String(obj.body.length),
					etag: '"e2e"',
					'last-modified': new Date().toUTCString()
				});
				res.end(method === 'GET' ? obj.body : undefined);
				return;
			}
			if (method === 'DELETE') {
				store.delete(id);
				res.writeHead(204).end();
				return;
			}
			res.writeHead(200).end();
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve());
	});
	const { port } = server.address() as AddressInfo;

	return {
		endpoint: `http://127.0.0.1:${port}`,
		size: () => store.size,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections?.();
				server.close(() => resolve());
			})
	};
}
