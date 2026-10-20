/**
 * Hintergrundjobs der Module (`ModuleDefinition.jobs`). Ein Zeitgeber prüft regelmäßig, welche
 * Jobs fällig sind; die Sperre ist ein atomares Upsert auf `job_run` (keine offene Transaktion
 * während des Laufs – wichtig für PGlite mit nur einer Sitzung). Mehrere Instanzen laufen
 * dadurch nicht doppelt.
 */
import { sql } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { systemContext } from '../auth/context';
import { auditFromContext } from '../audit/service';
import { getDb } from '../database/client';
import { errors } from '../errors';
import { allDefinitions } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';
import type { ModuleJob } from '../modules/types';

type Row = Record<string, unknown>;

const INTERVAL_MS: Record<ModuleJob['schedule'], number> = {
	hourly: 55 * 60_000,
	daily: 23 * 60 * 60_000
};
/** Ein Lauf ohne Abschluss gilt nach dieser Zeit als abgebrochen und darf neu starten */
const STALE_MS = 2 * 60 * 60_000;
const TICK_MS = 5 * 60_000;
const FIRST_TICK_MS = 30_000;

let clock: () => Date = () => new Date();
/** Nur für Tests: feste oder verschobene Uhr */
export function setJobClockForTests(fn: (() => Date) | undefined): void {
	clock = fn ?? (() => new Date());
}

export interface JobInfo {
	key: string;
	moduleId: string;
	id: string;
	summary: string;
	schedule: ModuleJob['schedule'];
	enabled: boolean;
	lastStartedAt: string | null;
	lastFinishedAt: string | null;
	lastStatus: 'ok' | 'error' | 'running' | null;
	lastMessage: string | null;
}

interface RegisteredJob {
	key: string;
	moduleId: string;
	job: ModuleJob;
}

function registeredJobs(): RegisteredJob[] {
	return allDefinitions().flatMap((d) =>
		(d.jobs ?? []).map((job) => ({
			key: `${d.manifest.id}.${job.id}`,
			moduleId: d.manifest.id,
			job
		}))
	);
}

const iso = (v: unknown): string | null =>
	v == null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();

async function rowsOf(query: ReturnType<typeof sql>): Promise<Row[]> {
	return ((await getDb().execute(query)) as unknown as { rows: Row[] }).rows;
}

/** Atomar beanspruchen; `force` ignoriert das Intervall (nicht aber einen laufenden Job). */
async function claim(
	key: string,
	schedule: ModuleJob['schedule'],
	force: boolean
): Promise<boolean> {
	const now = clock();
	const due = new Date(now.getTime() - (force ? 0 : INTERVAL_MS[schedule]));
	const stale = new Date(now.getTime() - STALE_MS);
	const found = await rowsOf(sql`
		INSERT INTO job_run (key, last_started_at, last_status) VALUES (${key}, ${now.toISOString()}, 'running')
		ON CONFLICT (key) DO UPDATE
			SET last_started_at = excluded.last_started_at, last_finished_at = NULL,
				last_status = 'running', last_message = NULL
			WHERE (job_run.last_finished_at IS NOT NULL AND job_run.last_started_at <= ${due.toISOString()})
				OR (job_run.last_finished_at IS NULL AND job_run.last_started_at <= ${stale.toISOString()})
				OR (${force} AND job_run.last_finished_at IS NOT NULL)
		RETURNING key`);
	return found.length > 0;
}

async function finish(key: string, status: 'ok' | 'error', message: string | null): Promise<void> {
	await getDb().execute(sql`
		UPDATE job_run SET last_finished_at = ${clock().toISOString()}, last_status = ${status},
			last_message = ${message ? message.slice(0, 500) : null}
		WHERE key = ${key}`);
}

async function execute(entry: RegisteredJob, ctx: RequestContext): Promise<JobInfo['lastStatus']> {
	try {
		const message = await entry.job.run(ctx);
		await finish(entry.key, 'ok', message || null);
		return 'ok';
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		console.error(`[jobs] ${entry.key} fehlgeschlagen:`, e);
		await finish(entry.key, 'error', message);
		return 'error';
	}
}

let pauseDepth = 0;

/** Pausiert den Job-Runner (z. B. während eines Admin-Resets); verschachtelbar. */
export function pauseJobs(): void {
	pauseDepth++;
}

/** Hebt eine `pauseJobs()`-Pause wieder auf. */
export function resumeJobs(): void {
	pauseDepth = Math.max(0, pauseDepth - 1);
}

export function jobsPaused(): boolean {
	return pauseDepth > 0;
}

/** Führt alle fälligen Jobs aktiver Module nacheinander aus. Gibt die gelaufenen Schlüssel zurück. */
export async function runDueJobs(): Promise<string[]> {
	const ran: string[] = [];
	for (const entry of registeredJobs()) {
		if (jobsPaused()) break;
		if (!(await isModuleEnabled(entry.moduleId))) continue;
		if (!(await claim(entry.key, entry.job.schedule, false))) continue;
		await execute(entry, systemContext(`job:${entry.key}`));
		ran.push(entry.key);
	}
	return ran;
}

export async function listJobs(): Promise<JobInfo[]> {
	const state = await rowsOf(sql`SELECT * FROM job_run`);
	const byKey = new Map(state.map((r) => [String(r.key), r]));
	const out: JobInfo[] = [];
	for (const entry of registeredJobs()) {
		const r = byKey.get(entry.key);
		out.push({
			key: entry.key,
			moduleId: entry.moduleId,
			id: entry.job.id,
			summary: entry.job.summary,
			schedule: entry.job.schedule,
			enabled: await isModuleEnabled(entry.moduleId),
			lastStartedAt: iso(r?.last_started_at),
			lastFinishedAt: iso(r?.last_finished_at),
			lastStatus: (r?.last_status as JobInfo['lastStatus']) ?? null,
			lastMessage: (r?.last_message as string | null) ?? null
		});
	}
	return out;
}

/** Manuell auslösen (Admin/Tests). 404 unbekannt oder Modul aus, 409 läuft bereits. */
export async function runJobNow(ctx: RequestContext, key: string): Promise<JobInfo> {
	const entry = registeredJobs().find((j) => j.key === key);
	if (!entry || !(await isModuleEnabled(entry.moduleId))) {
		throw errors.notFound('Job nicht gefunden');
	}
	if (jobsPaused()) throw errors.conflict('Jobs sind pausiert (Zurücksetzen läuft)');
	if (!(await claim(entry.key, entry.job.schedule, true))) {
		throw errors.conflict('Job läuft bereits');
	}
	await execute(entry, systemContext(`job:${entry.key}`));
	await auditFromContext(ctx, 'core.job.triggered', { target: key });
	const info = (await listJobs()).find((j) => j.key === key);
	if (!info) throw errors.notFound('Job nicht gefunden');
	return info;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

async function tick(): Promise<void> {
	if (running) return;
	running = true;
	try {
		await runDueJobs();
	} catch (e) {
		console.error('[jobs] Durchlauf fehlgeschlagen:', e);
	} finally {
		running = false;
	}
}

/** Startet den Zeitgeber (einmalig, nicht beim Build und nicht mit `JOBS_DISABLED=1`). */
export function startJobRunner(): void {
	if (timer || process.env.JOBS_DISABLED === '1') return;
	setTimeout(() => void tick(), FIRST_TICK_MS).unref?.();
	timer = setInterval(() => void tick(), TICK_MS);
	timer.unref?.();
}
