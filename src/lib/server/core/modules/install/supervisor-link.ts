/**
 * Verbindung der App zum Supervisor (Kalypzo Atrium, Phase 6, `scripts/supervisor/`): Der Supervisor startet die App
 * als Kindprozess mit IPC und `ATRIUM_SUPERVISOR=1`, `ATRIUM_DATA_DIR`. Eine Installation legt die Dateien in
 * `<data>/staging/<planId>/` ab und bittet per IPC um einen Neubau; der Supervisor schreibt seinen Stand nach
 * `<data>/status.json` und das Ergebnis nach `<data>/results/<planId>.json`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../database/client';
import { errors } from '../../errors';
import type { ArchiveFiles } from './archive';

export interface LockEntry {
	version: string;
	sourceType: 'github' | 'upload' | 'builtin';
	source: Record<string, unknown>;
	commit: string | null;
	contentHash: string;
}

export interface BuildRequest {
	planId: string;
	requestedBy: string;
	requestedAt: string;
	/** Module, die (neu) eingespielt werden; Dateien unter `modules/<id>/` */
	modules: Record<string, LockEntry>;
	/** Module, die entfernt werden (Phase 7) */
	remove: string[];
}

export type SupervisorState =
	'idle' | 'queued' | 'building' | 'verifying' | 'restarting' | 'done' | 'failed';

export interface SupervisorStatus {
	state: SupervisorState;
	planId: string | null;
	generation: string | null;
	/** Generation, die gerade läuft */
	running: string | null;
	step: string | null;
	message: string | null;
	startedAt: string | null;
	finishedAt: string | null;
	/** Letzte Zeilen des Build-Protokolls */
	logTail: string[];
}

export interface BuildResult {
	planId: string;
	status: 'done' | 'failed';
	generation: string | null;
	message: string;
	finishedAt: string;
}

export function supervisorDataDir(): string | null {
	const d = process.env.ATRIUM_DATA_DIR?.trim();
	return d ? resolve(d) : null;
}

/** Läuft die App unter dem Supervisor (IPC vorhanden)? */
export function supervisorAvailable(): boolean {
	return (
		process.env.ATRIUM_SUPERVISOR === '1' &&
		typeof process.send === 'function' &&
		supervisorDataDir() !== null
	);
}

/** Dateien und Auftrag ablegen, dann per IPC den Neubau anfordern */
export async function requestSupervisorBuild(
	request: BuildRequest,
	files: Map<string, ArchiveFiles>
): Promise<void> {
	const data = supervisorDataDir();
	if (!data || !supervisorAvailable()) throw errors.unavailable('Kein Supervisor verfügbar');
	if (!/^[A-Za-z0-9_-]{8,80}$/.test(request.planId)) throw errors.badRequest('Ungültiger Plan');
	const root = join(data, 'staging', request.planId);
	for (const [id, tree] of files) {
		const dir = resolve(root, 'modules', id);
		for (const [rel, bytes] of tree) {
			const target = resolve(dir, rel);
			if (!target.startsWith(dir + sep)) throw errors.badRequest('Ungültiger Pfad im Modul');
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, bytes);
		}
	}
	await mkdir(root, { recursive: true });
	await writeFile(join(root, 'request.json'), JSON.stringify(request, null, '\t'));
	process.send!({ type: 'atrium:build', planId: request.planId });
}

const IDLE: SupervisorStatus = {
	state: 'idle',
	planId: null,
	generation: null,
	running: process.env.ATRIUM_GENERATION ?? null,
	step: null,
	message: null,
	startedAt: null,
	finishedAt: null,
	logTail: []
};

export function readSupervisorStatus(): SupervisorStatus {
	const data = supervisorDataDir();
	if (!data) return IDLE;
	try {
		const raw = JSON.parse(
			readFileSync(join(data, 'status.json'), 'utf8')
		) as Partial<SupervisorStatus>;
		return { ...IDLE, ...raw, running: process.env.ATRIUM_GENERATION ?? raw.running ?? null };
	} catch {
		return IDLE;
	}
}

/**
 * Beim Start: angeforderte Installationen mit dem Ergebnis des Supervisors abgleichen (`requested` → `done`/`failed`).
 * Fehlt ein Ergebnis, bleibt der Eintrag stehen (Neubau läuft noch oder wurde abgebrochen).
 */
export async function reconcileInstallEvents(): Promise<number> {
	const data = supervisorDataDir();
	if (!data) return 0;
	const dir = join(data, 'results');
	if (!existsSync(dir)) return 0;
	const db = getDb();
	const open = await db
		.select()
		.from(schema.moduleInstallEvent)
		.where(eq(schema.moduleInstallEvent.status, 'requested'));
	let changed = 0;
	const results = new Map<string, BuildResult>();
	for (const f of readdirSync(dir)) {
		if (!f.endsWith('.json')) continue;
		try {
			const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as BuildResult;
			results.set(r.planId, r);
		} catch {
			// unlesbares Ergebnis überspringen
		}
	}
	for (const ev of open) {
		const r = ev.planId ? results.get(ev.planId) : undefined;
		if (!r) continue;
		// Erfolgreich gebaut: jetzt erst Wunschzustand (Quelle, Commit, Inhalt) festschreiben
		if (r.status === 'done' && ev.toVersion && ev.contentHash && ev.sourceType) {
			const row = {
				version: ev.toVersion,
				sourceType: ev.sourceType,
				source: ev.source,
				commit: ev.commit,
				contentHash: ev.contentHash,
				installedAt: new Date(),
				installedBy: ev.actorId
			};
			await db
				.insert(schema.moduleInstall)
				.values({ id: ev.moduleId, ...row })
				.onConflictDoUpdate({ target: schema.moduleInstall.id, set: row });
		}
		await db
			.update(schema.moduleInstallEvent)
			.set({ status: r.status, detail: r.message.slice(0, 500) })
			.where(
				and(
					eq(schema.moduleInstallEvent.id, ev.id),
					eq(schema.moduleInstallEvent.status, 'requested')
				)
			);
		changed++;
	}
	return changed;
}

// --- Quell-Cache für ZIP-Uploads ----------------------------------------------------------------

export async function cacheUploadedSource(zipSha256: string, zip: Uint8Array): Promise<void> {
	const data = supervisorDataDir();
	if (!data || !/^[0-9a-f]{64}$/.test(zipSha256)) return;
	await mkdir(join(data, 'sources'), { recursive: true });
	await writeFile(join(data, 'sources', `${zipSha256}.zip`), zip);
}

export async function cachedUpload(zipSha256: string): Promise<Uint8Array | null> {
	const data = supervisorDataDir();
	if (!data || !/^[0-9a-f]{64}$/.test(zipSha256)) return null;
	const file = join(data, 'sources', `${zipSha256}.zip`);
	return existsSync(file) ? new Uint8Array(await readFile(file)) : null;
}

/** Modulverzeichnis zur Laufzeit (wie `tools/modules-dir.js`, aber relativ zum Arbeitsverzeichnis des Servers) */
export function runtimeModulesDir(): string {
	const raw = process.env.ATRIUM_MODULES_DIR?.trim();
	return raw
		? isAbsolute(raw)
			? raw
			: resolve(process.cwd(), raw)
		: join(process.cwd(), 'modules');
}
