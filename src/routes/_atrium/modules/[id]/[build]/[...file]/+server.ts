import { readFile } from 'node:fs/promises';
import { error } from '@sveltejs/kit';
import {
	UTILITIES_FILE,
	UTILITIES_ID,
	bundleClientFile,
	bundleUtilities
} from '$lib/server/core/modules/bundles';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	js: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8',
	json: 'application/json; charset=utf-8',
	wasm: 'application/wasm',
	svg: 'image/svg+xml',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif',
	woff2: 'font/woff2',
	woff: 'font/woff',
	ttf: 'font/ttf',
	txt: 'text/plain; charset=utf-8'
};

/**
 * Browser-Dateien vorkompilierter Modul-Bundles (`ATRIUM_DATA_DIR/bundles/<id>/<build>/client/…`). Nur geladene Builds,
 * nur unter `client/`, nur bekannte Dateitypen. Der Build-Ordner wechselt mit jedem neuen Kompilat → unveränderlich
 * cachebar wie `/_app/immutable`.
 */
export const GET: RequestHandler = async ({ params }) => {
	const headers = {
		'cache-control': 'public, max-age=31536000, immutable',
		'x-content-type-options': 'nosniff'
	};
	// Gemeinsames Utilities-CSS (Core + Bundles): nur unter seinem aktuellen Hash
	if (params.id === UTILITIES_ID) {
		const u = await bundleUtilities();
		if (!u || params.build !== u.hash || params.file !== UTILITIES_FILE) throw error(404);
		return new Response(u.css, { headers: { ...headers, 'content-type': TYPES.css! } });
	}
	const ext = /\.([a-z0-9]+)$/i.exec(params.file)?.[1]?.toLowerCase() ?? '';
	const type = TYPES[ext];
	const file = type ? bundleClientFile(params.id, params.build, params.file) : null;
	if (!type || !file) throw error(404);
	return new Response(new Uint8Array(await readFile(file)), {
		headers: { ...headers, 'content-type': type }
	});
};
