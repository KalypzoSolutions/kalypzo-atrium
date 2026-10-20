/** Datensicherung – temporäre Dateien unter `os.tmpdir()/ep-backup` (Export, Upload). */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { errors } from '../errors';
import { BACKUP_LIMITS } from './types';

const EXT = /^\.[a-z0-9]{1,16}$/;

export async function backupTempDir(): Promise<string> {
	const dir = join(tmpdir(), 'ep-backup');
	await mkdir(dir, { recursive: true, mode: 0o700 });
	return dir;
}

/** Neuer, eindeutiger Pfad (Datei wird nicht angelegt). */
export async function newTempPath(ext: string): Promise<string> {
	const safe = EXT.test(ext) ? ext : '.tmp';
	return join(await backupTempDir(), `${Date.now()}-${randomUUID()}${safe}`);
}

/** Datei löschen; Fehler (z. B. schon weg) werden ignoriert. */
export async function removeTemp(path: string): Promise<void> {
	try {
		await rm(path, { force: true });
	} catch {
		// still
	}
}

/** Alte Temp-Dateien wegräumen (Standard: älter als `tempMaxAgeMs`). Gibt die Anzahl zurück. */
export async function sweepTempFiles(
	maxAgeMs: number = BACKUP_LIMITS.tempMaxAgeMs
): Promise<number> {
	let removed = 0;
	try {
		const dir = await backupTempDir();
		const now = Date.now();
		for (const name of await readdir(dir)) {
			const p = join(dir, name);
			try {
				const s = await stat(p);
				if (!s.isFile() || now - s.mtimeMs < maxAgeMs) continue;
				await rm(p, { force: true });
				removed++;
			} catch {
				// gerade gelöscht oder gesperrt – beim nächsten Mal
			}
		}
	} catch {
		// Verzeichnis nicht lesbar – nichts zu tun
	}
	return removed;
}

/** Wirft 503 „Zu wenig Speicherplatz“, wenn im Temp-Verzeichnis weniger als `bytes` frei sind. */
export async function assertFreeSpace(bytes: number): Promise<void> {
	let free: number;
	try {
		const s = await statfs(await backupTempDir());
		free = Number(s.bavail) * Number(s.bsize);
	} catch {
		return;
	}
	if (Number.isFinite(free) && free < bytes) {
		throw errors.unavailable('Zu wenig Speicherplatz für die Datensicherung');
	}
}
