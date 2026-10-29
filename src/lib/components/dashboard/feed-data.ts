import { daysBetween } from '$lib/sdk/dates';
import type { DashboardFeed, DashboardFeedTodo } from '$lib/sdk/types/dashboard';

/** Wie lange ein laufender/fertiger Abruf geteilt wird (Seite + Kacheln → ein Request) */
const SHARE_MS = 5_000;
let cached: { at: number; promise: Promise<DashboardFeed> } | null = null;

/**
 * Lädt „Zu erledigen“ und „Diese Woche“ (`GET /dashboard/feed`) einmal für Seite und Kacheln.
 * `fresh` erzwingt einen neuen Abruf („Erneut laden“); Fehler werden nicht zwischengespeichert.
 */
export function loadDashboardFeed(fresh = false): Promise<DashboardFeed> {
	if (!fresh && cached && Date.now() - cached.at < SHARE_MS) return cached.promise;
	const promise = fetch('/dashboard/feed', { headers: { accept: 'application/json' } }).then(
		async (res) => {
			if (!res.ok) throw new Error('Die Übersicht konnte nicht geladen werden.');
			return ((await res.json()) as { data: DashboardFeed }).data;
		}
	);
	const entry = { at: Date.now(), promise };
	cached = entry;
	promise.catch(() => {
		if (cached === entry) cached = null;
	});
	return promise;
}

/** `2026-11-02` → `2.11.` */
export function shortDate(iso: string): string {
	const [, m, d] = iso.split('-');
	return `${Number(d)}.${Number(m)}.`;
}

/** Fristtext einer Zeile: „seit 20.10. überfällig“, „heute fällig“, „morgen fällig“, „bis 2.11.“ */
export function dueLabel(due: string | null | undefined, today: string): string {
	if (!due) return '';
	const d = daysBetween(today, due);
	if (d < 0) return `seit ${shortDate(due)} überfällig`;
	if (d === 0) return 'heute fällig';
	if (d === 1) return 'morgen fällig';
	return `bis ${shortDate(due)}`;
}

/**
 * Der eine Satz unter dem Titel der Übersicht: das Wichtigste aus „Zu erledigen“.
 * `null`, wenn nichts ansteht.
 */
export function feedFinding(todos: DashboardFeedTodo[], today: string): string | null {
	const overdue = todos.filter((t) => t.severity === 'overdue');
	if (overdue.length) {
		const oldest = overdue.reduce((a, b) => ((a.due ?? today) <= (b.due ?? today) ? a : b));
		const days = oldest.due ? daysBetween(oldest.due, today) : 0;
		const since = days === 1 ? 'seit gestern' : days > 1 ? `seit ${days} Tagen` : '';
		if (overdue.length === 1) return `${oldest.title}: ${since ? `${since} ` : ''}überfällig.`;
		return `${overdue.length} Dinge sind überfällig${since ? `, das älteste ${since}` : ''}.`;
	}
	if (!todos.length) return null;
	return todos.length === 1
		? 'Eine Sache steht an, nichts ist überfällig.'
		: `${todos.length} Dinge stehen an, nichts ist überfällig.`;
}
