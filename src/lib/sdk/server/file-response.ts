import { t } from '$lib/i18n';
/**
 * Einheitlich gehärtete Datei-Antworten und Inhaltsprüfung für Module (#67, 01b-11).
 *
 * `secureFileResponse` setzt für **jede** ausgelieferte Datei (Belege, Dokumente, Bilder):
 * - `content-security-policy: default-src 'none'; sandbox` – auch falls doch einmal aktiver Inhalt durchrutscht,
 *   läuft er ohne Skripte und in eigenem (opaken) Origin statt im App-Kontext;
 * - `x-content-type-options: nosniff`;
 * - `content-disposition` nach RFC 6266/5987 (ASCII-Ersatzname + UTF-8-Name);
 * - aktive Typen (`text/html`, `image/svg+xml`, XHTML/XML, JavaScript) **nie inline**, sondern als
 *   `application/octet-stream` + `attachment`; inline nur Rasterbilder, PDF und reiner Text.
 *
 * `detectContentType`/`assertContentMatches` prüfen die ersten Bytes (Magic Bytes) gegen den angegebenen Typ,
 * damit ein Upload mit falschem Inhalt (z. B. HTML als „PDF“) mit 422 abgelehnt wird.
 */
import { errors } from '$lib/server/core/errors';

const OCTET = 'application/octet-stream';

/** Typen, die nie inline ausgeliefert werden (aktiver Inhalt im Browser) */
export const ACTIVE_CONTENT_TYPES = [
	'text/html',
	'image/svg+xml',
	'application/xhtml+xml',
	'application/xml',
	'text/xml',
	'text/javascript',
	'application/javascript'
] as const;

const INLINE_TYPES = new Set([
	'image/jpeg',
	'image/png',
	'image/webp',
	'image/gif',
	'image/avif',
	'application/pdf',
	'text/plain'
]);

function baseType(contentType: string): string {
	return contentType.split(';')[0]!.trim().toLowerCase();
}

/** `content-disposition` nach RFC 6266/5987 mit ASCII-Ersatznamen */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
	const clean = name.replace(/[\p{Cc}"\\]/gu, '').trim();
	const ascii =
		clean
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^A-Za-z0-9._ -]+/g, '_')
			.trim() || 'datei';
	const encoded = encodeURIComponent(clean || 'datei').replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);
	return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export interface FileResponseOptions {
	/** Gespeicherter MIME-Typ der Datei */
	contentType: string;
	/** Länge in Byte (für `content-length`), falls bekannt */
	size?: number;
	/** Dateiname für `content-disposition` (Standard `datei`) */
	name?: string;
	/** `true` → immer `attachment` (Download) */
	download?: boolean;
	/** `cache-control` (Standard `private, max-age=60`) */
	cache?: string;
	status?: number;
}

/** Gehärtete Datei-Antwort (siehe Dateikommentar). */
export function secureFileResponse(
	body: ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer | Blob,
	opts: FileResponseOptions
): Response {
	const ct = baseType(opts.contentType || OCTET);
	const active = (ACTIVE_CONTENT_TYPES as readonly string[]).includes(ct);
	const inline = !active && !opts.download && INLINE_TYPES.has(ct);
	let contentType: string;
	if (active) contentType = OCTET;
	else if (ct === 'text/plain') contentType = 'text/plain; charset=utf-8';
	else contentType = ct;
	const headers: Record<string, string> = {
		'content-type': contentType,
		'content-disposition': contentDisposition(
			inline ? 'inline' : 'attachment',
			opts.name ?? 'datei'
		),
		'x-content-type-options': 'nosniff',
		'content-security-policy': "default-src 'none'; sandbox",
		'cache-control': opts.cache ?? 'private, max-age=60'
	};
	if (typeof opts.size === 'number' && Number.isFinite(opts.size)) {
		headers['content-length'] = String(opts.size);
	}
	return new Response(body as BodyInit, { status: opts.status ?? 200, headers });
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
	if (bytes.length < offset + sig.length) return false;
	return sig.every((b, i) => bytes[offset + i] === b);
}

/**
 * Erkennt den Typ an den ersten Bytes: PNG, JPEG, GIF, WebP, AVIF/HEIC, PDF, ZIP-basierte Office-Dateien
 * (`application/zip`). `null` = unbekannt.
 */
export function detectContentType(bytes: Uint8Array): string | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
	if (
		startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
	) {
		return 'image/webp';
	}
	if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
		const brand = String.fromCharCode(...bytes.slice(8, 12));
		if (brand === 'avif' || brand === 'avis') return 'image/avif';
		if (/^hei[cxs]|^mif1/.test(brand)) return 'image/heic';
	}
	if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
	if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
	return null;
}

/** Typen, deren Inhalt `detectContentType` als ZIP erkennt (OOXML/ODF) */
const ZIP_CONTAINERS = new Set([
	'application/zip',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.template',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
	'application/vnd.openxmlformats-officedocument.presentationml.template',
	'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
	'application/vnd.oasis.opendocument.text',
	'application/vnd.oasis.opendocument.spreadsheet',
	'application/vnd.oasis.opendocument.presentation',
	'application/vnd.oasis.opendocument.text-template',
	'application/vnd.oasis.opendocument.spreadsheet-template',
	'application/vnd.oasis.opendocument.presentation-template'
]);

/**
 * Wirft 422, wenn der Inhalt nicht zum angegebenen Typ passt. Geprüft werden Bilder, PDF und ZIP-basierte
 * Office-Formate; für andere Typen (z. B. `text/plain`, `text/csv`) gibt es keine Signatur – dort wird nur
 * abgelehnt, was eindeutig ein Bild/PDF/ZIP ist **oder** wie HTML/SVG/Skript aussieht.
 */
export function assertContentMatches(
	bytes: Uint8Array,
	declaredType: string,
	path: (string | number)[] = ['file']
): void {
	const declared = baseType(declaredType);
	const detected = detectContentType(bytes);
	const fail = () => errors.validation([{ path, message: t('sdk.file.contentMismatch') }]);
	if (declared.startsWith('image/') || declared === 'application/pdf') {
		if (detected !== declared) throw fail();
		return;
	}
	if (ZIP_CONTAINERS.has(declared)) {
		if (detected !== 'application/zip') throw fail();
		return;
	}
	if (detected) throw fail();
	const head = new TextDecoder('utf-8', { fatal: false })
		.decode(bytes.slice(0, 512))
		.trimStart()
		.toLowerCase();
	if (/^(<!doctype html|<html|<svg|<\?xml|<script)/.test(head)) throw fail();
}
