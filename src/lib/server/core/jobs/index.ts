/**
 * Hintergrundjobs des Cores (`CORE_JOBS`, Schlüssel `core.<id>`, immer aktiv) und der Module
 * (`ModuleDefinition.jobs`). Ein Zeitgeber prüft regelmäßig, welche
 * Jobs fällig sind; die Sperre ist ein atomares Upsert auf `job_run` (keine offene Transaktion
 * während des Laufs – wichtig für PGlite mit nur einer Sitzung). Mehrere Instanzen laufen
 * dadurch nicht doppelt.
 *
 * Zustand je Schlüssel in `job_run` (ohne eigene Heartbeat-Spalte, #65):
 * - `last_status = 'running'`: Lauf aktiv. `last_finished_at` dient dann als **Heartbeat** (Lease),
 *   den der laufende Prozess alle `HEARTBEAT_MS` fortschreibt. Erst wenn der Heartbeat (bzw. ohne
 *   Heartbeat der Start) älter als `STALE_MS` ist, gilt der Lauf als abgebrochen.
 * - `ok`/`error`: Lauf beendet, `last_finished_at` = Ende. Nach `error` folgt ein neuer Versuch
 *   schon nach `RETRY_MS` statt erst nach dem vollen Intervall.
 * - Intervall-Jobs (`{ everyMinutes }`) starten frühestens `everyMinutes` nach ihrem letzten Start
 *   (der Zeitgeber prüft jede Minute).
 * - `daily`-Jobs starten nur im Zeitfenster `JOBS_DAILY_WINDOW` (volle Stunden in Europe/Berlin,
 *   Standard `6-20` = 06:00 bis vor 20:00) und höchstens einmal je Kalendertag.
 */
import { sql } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { systemContext } from '../auth/context';
import { auditFromContext } from '../audit/service';
import { getDb } from '../database/client';
import { errorSummary, logError } from '../db-errors';
import { errors } from '../errors';
import { allDefinitions } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';
import { requirePermission } from '../permissions/service';
import type { ModuleJob } from '../modules/types';
import { runHousekeeping } from './housekeeping';
import { reprocessLegacyAvatars } from '../auth/profile';
import { runNotificationDigest } from '../notifications/service';

type Row = Record<string, unknown>;

/** Mindestabstand zwischen zwei Starts eines `hourly`-Jobs */
const HOURLY_MS = 55 * 60_000;
/** Neuer Versuch nach einem Fehlschlag (nächster Tick nach 15 min, nicht erst nach dem Intervall) */
export const RETRY_MS = 15 * 60_000;
/** So oft schreibt ein laufender Job seinen Heartbeat fort */
const HEARTBEAT_MS = 60_000;
/** Ein laufender Job ohne Heartbeat seit dieser Zeit gilt als abgebrochen und darf neu starten */
export const STALE_MS = 10 * 60_000;
const DAILY_TIME_ZONE = 'Europe/Berlin';
const DEFAULT_DAILY_WINDOW = { from: 6, to: 20 };
const TICK_MS = 60_000;
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

/** Jobs des Cores (Pseudo-Modul `core`, nicht abschaltbar) */
const CORE_JOBS: ModuleJob[] = [
	{
		id: 'housekeeping',
		summary: 'Aufbewahrungsfristen durchsetzen (API-Protokoll, Audit-Log)',
		schedule: 'daily',
		run: async (ctx) => {
			const r = await runHousekeeping(ctx, clock());
			return `API-Protokoll: ${r.apiLogDeleted} gelöscht; Audit-Log: ${r.auditDeleted} gelöscht, ${r.auditIpCleared} IP-Adressen entfernt`;
		}
	},
	{
		id: 'avatars-reprocess',
		summary: 'Alte Profilbilder bereinigen (neu kodieren, Metadaten entfernen)',
		schedule: 'hourly',
		run: async (ctx) => {
			const r = await reprocessLegacyAvatars(ctx);
			return `Profilbilder: ${r.processed} bereinigt, ${r.removed} entfernt, ${r.skipped} übersprungen`;
		}
	},
	{
		id: 'notifications-digest',
		summary: 'Tageszusammenfassung der Benachrichtigungen (E-Mail/Push) verschicken',
		schedule: 'daily',
		run: async () => {
			const r = await runNotificationDigest(clock());
			return `Tageszusammenfassung: ${r.users} Personen, ${r.email} Mails, ${r.push} Push, ${r.expired} verworfen`;
		}
	}
];

function registeredJobs(): RegisteredJob[] {
	return [
		...allDefinitions().flatMap((d) =>
			(d.jobs ?? []).map((job) => ({
				key: `${d.manifest.id}.${job.id}`,
				moduleId: d.manifest.id,
				job
			}))
		),
		...CORE_JOBS.map((job) => ({ key: `core.${job.id}`, moduleId: 'core', job }))
	];
}

/** Core-Jobs laufen immer, Modul-Jobs nur bei aktivem Modul. */
const jobEnabled = (moduleId: string) =>
	moduleId === 'core' ? Promise.resolve(true) : isModuleEnabled(moduleId);

/**
 * Zeitfenster für `daily`-Jobs aus `JOBS_DAILY_WINDOW` (`"<von>-<bis>"`, volle Stunden 0–24 in
 * Europe/Berlin, `von < bis`). Ungültige Angaben fallen auf den Standard `6-20` zurück.
 */
export function dailyWindow(raw = process.env.JOBS_DAILY_WINDOW): { from: number; to: number } {
	const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(raw ?? '');
	if (!m) return DEFAULT_DAILY_WINDOW;
	const from = Number(m[1]);
	const to = Number(m[2]);
	return to <= 24 && from < to ? { from, to } : DEFAULT_DAILY_WINDOW;
}

const berlinFormat = new Intl.DateTimeFormat('en-CA', {
	timeZone: DAILY_TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hourCycle: 'h23'
});

/** Wanduhr in Europe/Berlin, als UTC-Millisekunden gelesen (für die Offset-Berechnung) */
function wallClockMs(d: Date): number {
	const p: Record<string, string> = {};
	for (const part of berlinFormat.formatToParts(d)) p[part.type] = part.value;
	return Date.UTC(
		Number(p.year),
		Number(p.month) - 1,
		Number(p.day),
		Number(p.hour),
		Number(p.minute),
		Number(p.second)
	);
}

/** Zeitpunkt `hour:00` Ortszeit (Europe/Berlin) am Kalendertag von `now` (`24` = Folgetag 0 Uhr) */
function berlinTimeToday(now: Date, hour: number): Date {
	const wall = new Date(wallClockMs(now));
	const target = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), hour);
	// Offset an der Zielzeit bestimmen (zweimal, damit Sommerzeit-Wechsel stimmen)
	let guess = target - (wallClockMs(new Date(target)) - target);
	guess = target - (wallClockMs(new Date(guess)) - guess);
	return new Date(guess);
}

/**
 * Ein beendeter Job ist wieder fällig, wenn sein letzter Start vor dem gelieferten Zeitpunkt liegt;
 * `null` = er darf jetzt gar nicht regulär starten (`daily` außerhalb des Zeitfensters).
 */
export function dueBefore(schedule: ModuleJob['schedule'], now: Date): Date | null {
	if (schedule === 'hourly') return new Date(now.getTime() - HOURLY_MS + 1);
	if (typeof schedule === 'object') {
		// 5 s Spielraum, damit ein Minuten-Job bei leicht verspätetem Tick nicht eine Runde aussetzt
		return new Date(now.getTime() - schedule.everyMinutes * 60_000 + 5_000);
	}
	const { from, to } = dailyWindow();
	const start = berlinTimeToday(now, from);
	if (now < start || now >= berlinTimeToday(now, to)) return null;
	return start;
}

const iso = (v: unknown): string | null =>
	v == null ? null : (v instanceof Date ? v : new Date(String(v))).toISOString();

async function rowsOf(query: ReturnType<typeof sql>): Promise<Row[]> {
	return ((await getDb().execute(query)) as unknown as { rows: Row[] }).rows;
}

/**
 * Atomar beanspruchen (ein einziges Upsert – kein Doppellauf, auch nicht über mehrere Instanzen).
 * Übernommen wird ein Schlüssel nur, wenn
 * - er beendet ist und der letzte Start vor `dueBefore` liegt (Intervall bzw. Zeitfenster),
 * - der letzte Lauf fehlschlug und `RETRY_MS` vergangen sind (bei `daily` nur im Zeitfenster),
 * - `force` gilt (manueller Start) und er nicht läuft,
 * - oder er als laufend markiert ist, der Heartbeat aber älter als `STALE_MS` ist (abgebrochen).
 * Liefert den Startzeitpunkt (Besitzmarke für Heartbeat und Abschluss) oder `null`.
 */
async function claim(
	key: string,
	schedule: ModuleJob['schedule'],
	force: boolean
): Promise<string | null> {
	const now = clock();
	const due = dueBefore(schedule, now);
	const regular = due !== null;
	const dueIso = (due ?? new Date(0)).toISOString();
	const retryIso = new Date(now.getTime() - RETRY_MS).toISOString();
	const staleIso = new Date(now.getTime() - STALE_MS).toISOString();
	const startedAt = now.toISOString();
	const found = await rowsOf(sql`
		INSERT INTO job_run (key, last_started_at, last_status)
		SELECT ${key}, ${startedAt}::timestamptz, 'running' WHERE ${regular || force}
		ON CONFLICT (key) DO UPDATE
			SET last_started_at = excluded.last_started_at, last_finished_at = NULL,
				last_status = 'running', last_message = NULL
			WHERE (job_run.last_status IS DISTINCT FROM 'running' AND (
					${force}
					OR (${regular} AND job_run.last_started_at < ${dueIso})
					OR (${regular} AND job_run.last_status = 'error'
						AND job_run.last_started_at <= ${retryIso})))
				OR (job_run.last_status = 'running'
					AND COALESCE(job_run.last_finished_at, job_run.last_started_at) <= ${staleIso})
		RETURNING key`);
	return found.length > 0 ? startedAt : null;
}

/** Lease verlängern – nur solange dieser Lauf (Startmarke) den Schlüssel noch besitzt. */
async function heartbeat(key: string, startedAt: string): Promise<void> {
	await getDb().execute(sql`
		UPDATE job_run SET last_finished_at = ${clock().toISOString()}
		WHERE key = ${key} AND last_status = 'running' AND last_started_at = ${startedAt}`);
}

async function finish(
	key: string,
	startedAt: string,
	status: 'ok' | 'error',
	message: string | null
): Promise<void> {
	// Nur den eigenen Lauf abschließen: wurde die (abgelaufene) Sperre übernommen, bleibt sie stehen
	await getDb().execute(sql`
		UPDATE job_run SET last_finished_at = ${clock().toISOString()}, last_status = ${status},
			last_message = ${message ? message.slice(0, 500) : null}
		WHERE key = ${key} AND last_started_at = ${startedAt}`);
}

let heartbeatMs = HEARTBEAT_MS;
/** Nur für Tests: Heartbeat-Abstand ändern (`undefined` = Standard) */
export function setJobHeartbeatForTests(ms: number | undefined): void {
	heartbeatMs = ms ?? HEARTBEAT_MS;
}

async function execute(
	entry: RegisteredJob,
	ctx: RequestContext,
	startedAt: string
): Promise<JobInfo['lastStatus']> {
	const beat = setInterval(() => {
		heartbeat(entry.key, startedAt).catch((e) =>
			logError(`[jobs] ${entry.key}: Heartbeat fehlgeschlagen:`, e)
		);
	}, heartbeatMs);
	beat.unref?.();
	let status: 'ok' | 'error';
	let message: string | null;
	try {
		message = (await entry.job.run(ctx)) || null;
		status = 'ok';
	} catch (e) {
		// Nur Klasse + Ursache speichern – nie `e.message` (bei DB-Fehlern mit SQL-Parametern, #56)
		logError(`[jobs] ${entry.key} fehlgeschlagen:`, e);
		status = 'error';
		message = errorSummary(e);
	} finally {
		clearInterval(beat);
	}
	try {
		await finish(entry.key, startedAt, status, message);
	} catch (e) {
		// Ohne Abschluss bleibt der Lauf „running“ und wird nach STALE_MS erneut beansprucht
		logError(`[jobs] ${entry.key}: Abschluss nicht gespeichert:`, e);
	}
	return status;
}

/** Neutraler Ersatz für Altbestände mit SQL-Parametern in `last_message` */
export const LEGACY_JOB_MESSAGE = 'Fehler (Details aus Datenschutzgründen entfernt)';

/** Alte Meldungen im Format der Drizzle-Hülle (`Failed query: … params: …`) erkennen */
const legacyMessage = (m: string | null): boolean =>
	m != null && (m.startsWith('Failed query:') || m.includes('\nparams: '));

/**
 * Startlauf (#56): Vor der Umstellung gespeicherte `job_run.last_message` mit SQL und
 * Parameterwerten neutralisieren. Idempotent; läuft einmal je Prozess vor dem ersten Durchlauf.
 * Gibt die Zahl der bereinigten Zeilen zurück.
 */
export async function neutralizeLegacyJobMessages(): Promise<number> {
	const rows = await rowsOf(sql`
		UPDATE job_run SET last_message = ${LEGACY_JOB_MESSAGE}
		WHERE last_message LIKE 'Failed query:%' OR last_message LIKE ${'%\nparams: %'}
		RETURNING key`);
	return rows.length;
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
		// Fehler je Job isolieren: ein DB-Fehler bei Prüfung oder Sperre stoppt die übrigen Jobs nicht
		try {
			if (!(await jobEnabled(entry.moduleId))) continue;
			const startedAt = await claim(entry.key, entry.job.schedule, false);
			if (!startedAt) continue;
			await execute(entry, systemContext(`job:${entry.key}`), startedAt);
			ran.push(entry.key);
		} catch (e) {
			logError(`[jobs] ${entry.key}: übersprungen:`, e);
		}
	}
	return ran;
}

export async function listJobs(): Promise<JobInfo[]> {
	const state = await rowsOf(sql`SELECT * FROM job_run`);
	const byKey = new Map(state.map((r) => [String(r.key), r]));
	const out: JobInfo[] = [];
	for (const entry of registeredJobs()) {
		const r = byKey.get(entry.key);
		const status = (r?.last_status as JobInfo['lastStatus']) ?? null;
		out.push({
			key: entry.key,
			moduleId: entry.moduleId,
			id: entry.job.id,
			summary: entry.job.summary,
			schedule: entry.job.schedule,
			enabled: await jobEnabled(entry.moduleId),
			lastStartedAt: iso(r?.last_started_at),
			// Während eines Laufs steht in `last_finished_at` der Heartbeat, kein Ende
			lastFinishedAt: status === 'running' ? null : iso(r?.last_finished_at),
			lastStatus: status,
			lastMessage: legacyMessage((r?.last_message as string | null) ?? null)
				? LEGACY_JOB_MESSAGE
				: ((r?.last_message as string | null) ?? null)
		});
	}
	return out;
}

/** Manuell auslösen (Admin/Tests). 403 ohne `core.jobs.manage`, 404 unbekannt oder Modul aus, 409 läuft bereits. */
export async function runJobNow(ctx: RequestContext, key: string): Promise<JobInfo> {
	// Defense in Depth (#67): auch ohne REST-Router nur mit Recht (System hat alle Rechte)
	await requirePermission(ctx, 'core.jobs.manage');
	const entry = registeredJobs().find((j) => j.key === key);
	if (!entry || !(await jobEnabled(entry.moduleId))) {
		throw errors.notFound('Job nicht gefunden');
	}
	if (jobsPaused()) throw errors.conflict('Jobs sind pausiert (Zurücksetzen läuft)');
	const startedAt = await claim(entry.key, entry.job.schedule, true);
	if (!startedAt) throw errors.conflict('Job läuft bereits');
	await execute(entry, systemContext(`job:${entry.key}`), startedAt);
	await auditFromContext(ctx, 'core.job.triggered', { target: key });
	const info = (await listJobs()).find((j) => j.key === key);
	if (!info) throw errors.notFound('Job nicht gefunden');
	return info;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let legacyCleaned = false;

async function tick(): Promise<void> {
	if (running) return;
	running = true;
	try {
		if (!legacyCleaned) {
			legacyCleaned = true;
			await neutralizeLegacyJobMessages().catch((e) =>
				logError('[jobs] Altmeldungen nicht bereinigt:', e)
			);
		}
		await runDueJobs();
	} catch (e) {
		logError('[jobs] Durchlauf fehlgeschlagen:', e);
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
