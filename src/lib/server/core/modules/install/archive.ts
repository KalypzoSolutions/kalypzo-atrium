/**
 * Sicheres Entpacken von Modul-Archiven (ZIP, z. B. GitHub-„zipball“ oder Upload) im Speicher – ohne Dateisystem.
 *
 * Gelesen wird über das **zentrale Verzeichnis** (dort stehen Unix-Rechte, also auch Symlinks); jeder Eintrag wird
 * mit seinem lokalen Kopf abgeglichen. Abgelehnt werden: Symlinks/Gerätedateien, absolute Pfade, `..`, Backslash,
 * NUL, doppelte bzw. nur in Groß/Klein verschiedene Pfade, unbekannte Endungen, verschlüsselte oder ungewöhnlich
 * gepackte Einträge und „ZIP-Bomben“ (Grenzen siehe `ARCHIVE_LIMITS`). **Übersprungen** (nie entpackt, nicht im
 * Inhaltshash) werden versteckte Einträge (`.git/`, `.github/`, `.claude/`, `.env` …) und `node_modules/` – ein Repo
 * enthält sie neben den Modulen fast immer.
 * Ein gemeinsamer Oberordner (GitHub: `<owner>-<repo>-<sha>/`) wird entfernt.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { t } from '$lib/i18n';
import { errors } from '../../errors';

export const ARCHIVE_LIMITS = {
	/** Größe des Archivs */
	maxArchiveBytes: 50 * 1024 * 1024,
	maxFiles: 5000,
	/** Summe entpackt */
	maxTotalBytes: 50 * 1024 * 1024,
	maxFileBytes: 10 * 1024 * 1024,
	/** Entpackt / gepackt je Eintrag */
	maxRatio: 100,
	maxPathLength: 240
} as const;

/** Erlaubte Dateiendungen (alles andere bricht ab) */
export const ALLOWED_EXTENSIONS = new Set([
	'ts',
	'js',
	'mjs',
	'svelte',
	'sql',
	'json',
	'md',
	'css',
	'svg',
	'png',
	'webp',
	'jpg',
	'jpeg',
	'gif',
	'pdf',
	'woff2',
	'txt',
	'csv'
]);

/** Dateien ohne Endung, die vorkommen dürfen */
const ALLOWED_PLAIN = new Set(['LICENSE', 'LICENCE', 'NOTICE', 'README', 'CHANGELOG']);

export type ArchiveFiles = Map<string, Uint8Array>;

const fail = (message: string) => errors.validation([{ path: ['archive'], message }]);

function u16(b: Uint8Array, o: number): number {
	return b[o]! | (b[o + 1]! << 8);
}
function u32(b: Uint8Array, o: number): number {
	return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** Eintrag wird nicht entpackt (versteckt oder `node_modules`) */
const SKIP = Symbol('skip');

/** Pfad prüfen und normalisieren (nur `/`, keine leeren Segmente); `null` = Verzeichniseintrag */
function checkPath(raw: string): string | null | typeof SKIP {
	if (raw.includes('\0')) throw fail(t('install.archive.invalidFileName'));
	if (raw.includes('\\')) throw fail(t('install.archive.invalidPath', { path: raw.slice(0, 120) }));
	if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
		throw fail(t('install.archive.absolutePath', { path: raw.slice(0, 120) }));
	}
	if (raw.length > ARCHIVE_LIMITS.maxPathLength) throw fail(t('install.archive.pathTooLong'));
	const isDir = raw.endsWith('/');
	const parts = raw.split('/').filter((p, i, a) => !(p === '' && i === a.length - 1));
	for (const p of parts) {
		if (p === '' || p === '.' || p === '..') {
			throw fail(t('install.archive.invalidPath', { path: raw.slice(0, 120) }));
		}
		if (/[<>:"|?*]/.test(p) || [...p].some((c) => c.charCodeAt(0) < 0x20)) {
			throw fail(t('install.archive.invalidChar', { path: raw.slice(0, 120) }));
		}
	}
	if (parts.some((p) => p.startsWith('.') || p === 'node_modules')) return SKIP;
	return isDir ? null : parts.join('/');
}

function checkExtension(path: string): void {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		if (!ALLOWED_PLAIN.has(name)) throw fail(t('install.archive.typeNotAllowed', { path }));
		return;
	}
	const ext = name.slice(dot + 1).toLowerCase();
	if (!ALLOWED_EXTENSIONS.has(ext)) throw fail(t('install.archive.typeNotAllowed', { path }));
}

/**
 * Archiv lesen; liefert Pfad → Inhalt (ohne gemeinsamen Oberordner). Wirft 422 (Pfad `archive`) mit lesbarer
 * Meldung, wenn eine Regel verletzt ist.
 */
export function readModuleArchive(zip: Uint8Array): ArchiveFiles {
	if (zip.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
		throw errors.tooLarge(t('install.archive.tooLarge'));
	}
	// Ende des zentralen Verzeichnisses (EOCD) suchen – höchstens 64 KB Kommentar
	let eocd = -1;
	for (let i = zip.byteLength - 22; i >= Math.max(0, zip.byteLength - 22 - 0xffff); i--) {
		if (u32(zip, i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw fail(t('install.archive.notZip'));
	const count = u16(zip, eocd + 10);
	const cdSize = u32(zip, eocd + 12);
	const cdOffset = u32(zip, eocd + 16);
	if (count === 0xffff || cdOffset === 0xffffffff) throw fail(t('install.archive.zip64'));
	if (cdOffset + cdSize > eocd) throw fail(t('install.archive.corrupt'));
	if (count > ARCHIVE_LIMITS.maxFiles) throw fail(t('install.archive.tooManyFiles'));

	const decoder = new TextDecoder('utf-8', { fatal: true });
	const raw: { path: string; data: Uint8Array }[] = [];
	const seen = new Set<string>();
	let total = 0;
	let p = cdOffset;
	for (let n = 0; n < count; n++) {
		if (u32(zip, p) !== 0x02014b50) throw fail(t('install.archive.corrupt'));
		const madeBy = u16(zip, p + 4) >> 8;
		const flags = u16(zip, p + 8);
		const method = u16(zip, p + 10);
		const compSize = u32(zip, p + 20);
		const size = u32(zip, p + 24);
		const nameLen = u16(zip, p + 28);
		const extraLen = u16(zip, p + 30);
		const commentLen = u16(zip, p + 32);
		const external = u32(zip, p + 38);
		const localOffset = u32(zip, p + 42);
		let name: string;
		try {
			name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen));
		} catch {
			throw fail(t('install.archive.invalidFileName'));
		}
		p += 46 + nameLen + extraLen + commentLen;

		const path = checkPath(name);
		// Unix-Dateiart (obere 16 Bit bei „made by“ Unix = 3): nur reguläre Dateien und Ordner
		if (madeBy === 3) {
			const type = (external >>> 16) & 0o170000;
			if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
				throw fail(t('install.archive.symlink', { path: name.slice(0, 120) }));
			}
		}
		if (path === null || path === SKIP) continue;
		if (flags & 0x1) throw fail(t('install.archive.encrypted'));
		if (method !== 0 && method !== 8) throw fail(t('install.archive.compression', { path }));
		if (size > ARCHIVE_LIMITS.maxFileBytes) throw fail(t('install.archive.fileTooLarge', { path }));
		if (compSize > 0 && size / compSize > ARCHIVE_LIMITS.maxRatio) {
			throw fail(t('install.archive.ratio', { path }));
		}
		total += size;
		if (total > ARCHIVE_LIMITS.maxTotalBytes) throw fail(t('install.archive.unpackedTooLarge'));
		const key = path.toLowerCase();
		if (seen.has(key)) throw fail(t('install.archive.duplicate', { path }));
		seen.add(key);
		checkExtension(path);

		// Lokaler Kopf: Name muss übereinstimmen, Daten dahinter
		if (u32(zip, localOffset) !== 0x04034b50) throw fail(t('install.archive.corrupt'));
		const lNameLen = u16(zip, localOffset + 26);
		const lExtraLen = u16(zip, localOffset + 28);
		const lName = new TextDecoder().decode(
			zip.subarray(localOffset + 30, localOffset + 30 + lNameLen)
		);
		if (lName !== name) throw fail(t('install.archive.mismatch', { path }));
		const start = localOffset + 30 + lNameLen + lExtraLen;
		if (start + compSize > cdOffset) throw fail(t('install.archive.corrupt'));
		const packed = zip.subarray(start, start + compSize);
		let data: Uint8Array;
		try {
			data =
				method === 0
					? packed.slice()
					: new Uint8Array(inflateRawSync(packed, { maxOutputLength: size + 1 }));
		} catch {
			throw fail(t('install.archive.fileCorrupt', { path }));
		}
		if (data.byteLength !== size) throw fail(t('install.archive.fileCorrupt', { path }));
		raw.push({ path, data });
	}

	// Gemeinsamen Oberordner entfernen (GitHub-zipball)
	const tops = new Set(raw.map((f) => f.path.split('/')[0]));
	const strip = tops.size === 1 && raw.every((f) => f.path.includes('/'));
	const out: ArchiveFiles = new Map();
	for (const f of raw) out.set(strip ? f.path.slice(f.path.indexOf('/') + 1) : f.path, f.data);
	return out;
}

/** Inhaltshash eines Dateibaums: SHA-256 über die sortierten Paare (Pfad, Inhalt), unabhängig vom ZIP */
export function contentHash(files: ArchiveFiles, prefix = ''): string {
	const h = createHash('sha256');
	const keys = [...files.keys()].filter((k) => k.startsWith(prefix)).sort();
	for (const k of keys) {
		const data = files.get(k)!;
		h.update(k.slice(prefix.length));
		h.update('\0');
		h.update(String(data.byteLength));
		h.update('\0');
		h.update(data);
	}
	return `sha256-${h.digest('hex')}`;
}
