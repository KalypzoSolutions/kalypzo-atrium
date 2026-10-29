/**
 * Übersicht (`/dashboard`): sammelt „Zu erledigen“ und „Diese Woche“ aus den Quellen aktiver Module
 * (`ModuleDefinition.dashboard`). Jede Quelle nur mit Recht; Module filtern selbst objektbezogen.
 * Ablauf wie bei der globalen Suche: mit echtem Pool parallel (Zeitbudget je Quelle), mit PGlite
 * nacheinander; Fehler einer Quelle überspringen nur diese.
 */
import { addDays, isRealDate, todayBerlin } from '$lib/sdk/dates';
import type { RequestContext } from '$lib/sdk/types';
import {
	DASHBOARD_AGENDA_LIMIT,
	DASHBOARD_TODO_LIMIT,
	DASHBOARD_TODO_LIMIT_PER_SOURCE,
	type DashboardAgendaKind,
	type DashboardFeed,
	type DashboardFeedAgendaItem,
	type DashboardFeedTodo,
	type DashboardTodoSeverity
} from '$lib/sdk/types/dashboard';
import { databaseAllowsParallelQueries } from '../database/client';
import { allDefinitions } from '../modules/registry';
import { enabledModuleIds } from '../modules/state';
import type { ModuleDefinition } from '../modules/types';
import { allowed, isSafeHref } from '../search/service';

/** Zeitbudget je Quelle bei parallelem Abruf; danach wird die Quelle übersprungen */
export const DASHBOARD_SOURCE_BUDGET_MS = 3000;

const SEVERITIES: readonly DashboardTodoSeverity[] = ['overdue', 'due', 'info'];
const KINDS: readonly DashboardAgendaKind[] = [
	'meeting',
	'event',
	'action',
	'material',
	'deadline'
];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const text = (v: unknown, max: number): string =>
	String(v ?? '')
		.trim()
		.slice(0, max);
const optText = (v: unknown, max: number): string | undefined => text(v, max) || undefined;
const date = (v: unknown): string | null => (typeof v === 'string' && isRealDate(v) ? v : null);
const time = (v: unknown): string | null => (typeof v === 'string' && TIME.test(v) ? v : null);
const cents = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isSafeInteger(v) ? v : undefined;

/** Montag der Woche von `day` (ISO-Woche) */
export function mondayOf(day: string): string {
	const wd = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 = Sonntag
	return addDays(day, -((wd + 6) % 7));
}

const SEVERITY_RANK: Record<DashboardTodoSeverity, number> = { overdue: 0, due: 1, info: 2 };

/** Überfällig zuerst, dann nach Frist (ohne Frist zuletzt), dann Titel */
export function sortTodos<T extends Pick<DashboardFeedTodo, 'severity' | 'due' | 'title'>>(
	todos: T[]
): T[] {
	return todos.sort(
		(a, b) =>
			SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
			(a.due ?? '9999-12-31').localeCompare(b.due ?? '9999-12-31') ||
			a.title.localeCompare(b.title, 'de')
	);
}

/** Nach Tag, ganztägig vor Uhrzeit, dann Uhrzeit und Titel */
export function sortAgenda<T extends Pick<DashboardFeedAgendaItem, 'date' | 'startTime' | 'title'>>(
	items: T[]
): T[] {
	return items.sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			(a.startTime ?? '').localeCompare(b.startTime ?? '') ||
			a.title.localeCompare(b.title, 'de')
	);
}

function cleanTodos(def: ModuleDefinition, raw: unknown[], limit: number): DashboardFeedTodo[] {
	const out: DashboardFeedTodo[] = [];
	const seen = new Set<string>();
	for (const t of raw as Partial<DashboardFeedTodo>[]) {
		if (!t || typeof t !== 'object') continue;
		const id = text(t.id, 200);
		const title = text(t.title, 200);
		const href = t.action?.href;
		const label = text(t.action?.label, 40);
		if (!id || !title || !label || !isSafeHref(href) || seen.has(id)) continue;
		if (!SEVERITIES.includes(t.severity as DashboardTodoSeverity)) continue;
		seen.add(id);
		const p = t.payment;
		out.push({
			id,
			moduleId: def.manifest.id,
			moduleName: def.manifest.name,
			title,
			detail: optText(t.detail, 200),
			due: date(t.due),
			severity: t.severity as DashboardTodoSeverity,
			amountCents: cents(t.amountCents),
			action: { label, href },
			payment:
				p && text(p.iban, 40) && cents(p.amountCents) !== undefined
					? {
							holder: text(p.holder, 120),
							iban: text(p.iban, 40),
							bic: optText(p.bic, 20),
							amountCents: p.amountCents,
							reference: text(p.reference, 140)
						}
					: undefined
		});
		if (out.length >= limit) break;
	}
	return out;
}

function cleanAgenda(
	def: ModuleDefinition,
	raw: unknown[],
	from: string,
	to: string
): DashboardFeedAgendaItem[] {
	const out: DashboardFeedAgendaItem[] = [];
	const seen = new Set<string>();
	for (const a of raw as Partial<DashboardFeedAgendaItem>[]) {
		if (!a || typeof a !== 'object') continue;
		const id = text(a.id, 200);
		const title = text(a.title, 200);
		const day = date(a.date);
		const end = date(a.endDate) ?? day;
		if (!id || !title || !day || !end || !isSafeHref(a.href) || seen.has(id)) continue;
		if (!KINDS.includes(a.kind as DashboardAgendaKind)) continue;
		// Muss den Zeitraum berühren
		if (end < from || day > to || end < day) continue;
		seen.add(id);
		out.push({
			id,
			moduleId: def.manifest.id,
			kind: a.kind as DashboardAgendaKind,
			title,
			date: day,
			endDate: end !== day ? end : null,
			startTime: time(a.startTime),
			endTime: time(a.endTime),
			detail: optText(a.detail, 120),
			href: a.href,
			late: a.late === true || undefined,
			groupIds: Array.isArray(a.groupIds)
				? a.groupIds.filter((g): g is string => typeof g === 'string').slice(0, 20)
				: undefined
		});
	}
	return out;
}

/**
 * Gruppenstunden kommen aus den Gruppen (`members`) und oft zusätzlich als Terminserie (`events`,
 * „Gruppenstunde übernehmen“ setzt keinen Titel): eine `meeting`-Zeile entfällt, wenn am selben Tag
 * ein Termin derselben Gruppe zur selben Startzeit oder ein Termin mit gleichem Titel sichtbar ist.
 */
export function withoutDuplicateMeetings(
	items: DashboardFeedAgendaItem[]
): DashboardFeedAgendaItem[] {
	const norm = (t: string) => t.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();
	const events = items.filter((i) => i.kind === 'event');
	const covered = (m: DashboardFeedAgendaItem) =>
		events.some(
			(e) =>
				e.date <= m.date &&
				(e.endDate ?? e.date) >= m.date &&
				(norm(e.title) === norm(m.title) ||
					(e.startTime === m.startTime && (e.groupIds ?? []).some((g) => m.groupIds?.includes(g))))
		);
	return items.filter((i) => i.kind !== 'meeting' || !covered(i));
}

type Outcome<T> = { ok: true; items: T[] } | { ok: false };

function withBudget<T>(run: Promise<Outcome<T>>, id: string): Promise<Outcome<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const budget = new Promise<Outcome<T>>((resolve) => {
		timer = setTimeout(() => {
			console.error(`[dashboard] Quelle ${id} hat das Zeitbudget überschritten`);
			resolve({ ok: false });
		}, DASHBOARD_SOURCE_BUDGET_MS);
	});
	return Promise.race([run, budget]).finally(() => clearTimeout(timer));
}

async function runAll<T>(
	jobs: { id: string; run: () => Promise<T[]> }[]
): Promise<{ items: T[]; failed: string[] }> {
	const once = async (job: (typeof jobs)[number]): Promise<Outcome<T>> => {
		try {
			return { ok: true, items: await job.run() };
		} catch (e) {
			console.error(`[dashboard] Quelle ${job.id} fehlgeschlagen:`, e);
			return { ok: false };
		}
	};
	let results: Outcome<T>[];
	if (databaseAllowsParallelQueries()) {
		results = await Promise.all(jobs.map((j) => withBudget(once(j), j.id)));
	} else {
		// PGlite / eine Verbindung: strikt nacheinander
		results = [];
		for (const j of jobs) results.push(await once(j));
	}
	const items: T[] = [];
	const failed: string[] = [];
	results.forEach((r, i) => (r.ok ? items.push(...r.items) : failed.push(jobs[i]!.id)));
	return { items, failed };
}

/**
 * Inhalt der Übersicht für die angemeldete Person: offene Handlungen aller Quellen und die Einträge
 * der Woche (Montag–Sonntag) von `today`. Ohne `userId` (API-Key ohne Konto, System) leer.
 */
export async function collectDashboardFeed(
	ctx: RequestContext,
	opts: { today?: string } = {}
): Promise<DashboardFeed> {
	const today = opts.today && isRealDate(opts.today) ? opts.today : todayBerlin();
	const from = mondayOf(today);
	const to = addDays(from, 6);
	const empty: DashboardFeed = { today, from, to, todos: [], agenda: [], failed: [] };
	if (!ctx.userId) return empty;

	const enabled = await enabledModuleIds();
	const defs = allDefinitions().filter((d) => d.dashboard && enabled.has(d.manifest.id));

	const todoJobs = defs
		.filter((d) => d.dashboard!.todos && allowed(ctx, d.dashboard!.todos))
		.map((d) => ({
			id: d.manifest.id,
			run: async () =>
				cleanTodos(
					d,
					await d.dashboard!.todos!.run(ctx, { today, limit: DASHBOARD_TODO_LIMIT_PER_SOURCE }),
					DASHBOARD_TODO_LIMIT_PER_SOURCE
				)
		}));
	const agendaJobs = defs
		.filter((d) => d.dashboard!.agenda && allowed(ctx, d.dashboard!.agenda))
		.map((d) => ({
			id: d.manifest.id,
			run: async () =>
				cleanAgenda(d, await d.dashboard!.agenda!.run(ctx, { today, from, to }), from, to)
		}));

	const todos = await runAll(todoJobs);
	const agenda = await runAll(agendaJobs);
	agenda.items = withoutDuplicateMeetings(agenda.items);
	return {
		today,
		from,
		to,
		todos: sortTodos(todos.items).slice(0, DASHBOARD_TODO_LIMIT),
		agenda: sortAgenda(agenda.items).slice(0, DASHBOARD_AGENDA_LIMIT),
		failed: [...new Set([...todos.failed, ...agenda.failed])].map(
			(id) => defs.find((d) => d.manifest.id === id)?.manifest.name ?? id
		)
	};
}
