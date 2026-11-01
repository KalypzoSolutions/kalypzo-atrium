/**
 * Sicheres Entpacken von Modul-Archiven (ZIP, z. B. GitHub-„zipball“ oder Upload) im Speicher – ohne Dateisystem.
 *
 * Gelesen wird über das **zentrale Verzeichnis** (dort stehen Unix-Rechte, also auch Symlinks); jeder Eintrag wird
 * mit seinem lokalen Kopf abgeglichen. Abgelehnt werden: Symlinks/Gerätedateien, absolute Pfade, `..`, Backslash,
 * NUL, versteckte Dateien, `.git/`, `node_modules/`, doppelte bzw. nur in Groß/Klein verschiedene Pfade, unbekannte
 * Endungen, verschlüsselte oder ungewöhnlich gepackte Einträge und „ZIP-Bomben“ (Grenzen siehe `ARCHIVE_LIMITS`).
 * Ein gemeinsamer Oberordner (GitHub: `<owner>-<repo>-<sha>/`) wird entfernt.
 */
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
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

/** Pfad prüfen und normalisieren (nur `/`, keine leeren Segmente); `null` = Verzeichniseintrag */
function checkPath(raw: string): string | null {
	if (raw.includes('\0')) throw fail('Archiv enthält einen ungültigen Dateinamen');
	if (raw.includes('\\')) throw fail(`Ungültiger Pfad im Archiv: ${raw.slice(0, 120)}`);
	if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
		throw fail(`Absoluter Pfad im Archiv: ${raw.slice(0, 120)}`);
	}
	if (raw.length > ARCHIVE_LIMITS.maxPathLength) throw fail('Pfad im Archiv ist zu lang');
	const isDir = raw.endsWith('/');
	const parts = raw.split('/').filter((p, i, a) => !(p === '' && i === a.length - 1));
	for (const p of parts) {
		if (p === '' || p === '.' || p === '..') {
			throw fail(`Ungültiger Pfad im Archiv: ${raw.slice(0, 120)}`);
		}
		if (p.startsWith('.'))
			throw fail(`Versteckte Dateien sind nicht erlaubt: ${raw.slice(0, 120)}`);
		if (p === 'node_modules') throw fail('node_modules darf nicht im Archiv liegen');
		if (/[<>:"|?*]/.test(p) || [...p].some((c) => c.charCodeAt(0) < 0x20)) {
			throw fail(`Ungültiges Zeichen im Pfad: ${raw.slice(0, 120)}`);
		}
	}
	return isDir ? null : parts.join('/');
}

function checkExtension(path: string): void {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');
	if (dot <= 0) {
		if (!ALLOWED_PLAIN.has(name)) throw fail(`Dateityp nicht erlaubt: ${path}`);
		return;
	}
	const ext = name.slice(dot + 1).toLowerCase();
	if (!ALLOWED_EXTENSIONS.has(ext)) throw fail(`Dateityp nicht erlaubt: ${path}`);
}

/**
 * Archiv lesen; liefert Pfad → Inhalt (ohne gemeinsamen Oberordner). Wirft 422 (Pfad `archive`) mit lesbarer
 * Meldung, wenn eine Regel verletzt ist.
 */
export function readModuleArchive(zip: Uint8Array): ArchiveFiles {
	if (zip.byteLength > ARCHIVE_LIMITS.maxArchiveBytes) {
		throw errors.tooLarge('Das Archiv ist größer als 50 MB');
	}
	// Ende des zentralen Verzeichnisses (EOCD) suchen – höchstens 64 KB Kommentar
	let eocd = -1;
	for (let i = zip.byteLength - 22; i >= Math.max(0, zip.byteLength - 22 - 0xffff); i--) {
		if (u32(zip, i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw fail('Die Datei ist kein gültiges ZIP-Archiv');
	const count = u16(zip, eocd + 10);
	const cdSize = u32(zip, eocd + 12);
	const cdOffset = u32(zip, eocd + 16);
	if (count === 0xffff || cdOffset === 0xffffffff)
		throw fail('ZIP64-Archive werden nicht unterstützt');
	if (cdOffset + cdSize > eocd) throw fail('Das ZIP-Archiv ist beschädigt');
	if (count > ARCHIVE_LIMITS.maxFiles) throw fail('Das Archiv enthält zu viele Dateien');

	const decoder = new TextDecoder('utf-8', { fatal: true });
	const raw: { path: string; data: Uint8Array }[] = [];
	const seen = new Set<string>();
	let total = 0;
	let p = cdOffset;
	for (let n = 0; n < count; n++) {
		if (u32(zip, p) !== 0x02014b50) throw fail('Das ZIP-Archiv ist beschädigt');
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
			throw fail('Archiv enthält einen ungültigen Dateinamen');
		}
		p += 46 + nameLen + extraLen + commentLen;

		const path = checkPath(name);
		// Unix-Dateiart (obere 16 Bit bei „made by“ Unix = 3): nur reguläre Dateien und Ordner
		if (madeBy === 3) {
			const type = (external >>> 16) & 0o170000;
			if (type !== 0 && type !== 0o100000 && type !== 0o040000) {
				throw fail(`Symlinks und Sonderdateien sind nicht erlaubt: ${name.slice(0, 120)}`);
			}
		}
		if (path === null) continue;
		if (flags & 0x1) throw fail('Verschlüsselte Archive werden nicht unterstützt');
		if (method !== 0 && method !== 8) throw fail(`Nicht unterstützte Kompression: ${path}`);
		if (size > ARCHIVE_LIMITS.maxFileBytes) throw fail(`Datei zu groß (über 10 MB): ${path}`);
		if (compSize > 0 && size / compSize > ARCHIVE_LIMITS.maxRatio) {
			throw fail(`Ungewöhnlich stark gepackte Datei: ${path}`);
		}
		total += size;
		if (total > ARCHIVE_LIMITS.maxTotalBytes)
			throw fail('Das Archiv ist entpackt größer als 50 MB');
		const key = path.toLowerCase();
		if (seen.has(key)) throw fail(`Doppelter Pfad im Archiv: ${path}`);
		seen.add(key);
		checkExtension(path);

		// Lokaler Kopf: Name muss übereinstimmen, Daten dahinter
		if (u32(zip, localOffset) !== 0x04034b50) throw fail('Das ZIP-Archiv ist beschädigt');
		const lNameLen = u16(zip, localOffset + 26);
		const lExtraLen = u16(zip, localOffset + 28);
		const lName = new TextDecoder().decode(
			zip.subarray(localOffset + 30, localOffset + 30 + lNameLen)
		);
		if (lName !== name) throw fail(`Archiv-Eintrag widersprüchlich: ${path}`);
		const start = localOffset + 30 + lNameLen + lExtraLen;
		if (start + compSize > cdOffset) throw fail('Das ZIP-Archiv ist beschädigt');
		const packed = zip.subarray(start, start + compSize);
		let data: Uint8Array;
		try {
			data =
				method === 0
					? packed.slice()
					: new Uint8Array(inflateRawSync(packed, { maxOutputLength: size + 1 }));
		} catch {
			throw fail(`Datei im Archiv ist beschädigt: ${path}`);
		}
		if (data.byteLength !== size) throw fail(`Datei im Archiv ist beschädigt: ${path}`);
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
