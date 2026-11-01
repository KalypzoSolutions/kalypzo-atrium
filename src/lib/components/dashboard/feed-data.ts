import { daysBetween } from '$lib/sdk/dates';
import { intlLocale, t } from '$lib/i18n';
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
			if (!res.ok) throw new Error(t('widgets.loadFailed'));
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

/** `2026-11-02` → `2.11.` (Englisch `02/11`) */
export function shortDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return iso;
	return new Intl.DateTimeFormat(intlLocale(), {
		day: 'numeric',
		month: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(y, m - 1, d)));
}

/** Fristtext einer Zeile: „seit 20.10. überfällig“, „heute fällig“, „morgen fällig“, „bis 2.11.“ */
export function dueLabel(due: string | null | undefined, today: string): string {
	if (!due) return '';
	const d = daysBetween(today, due);
	if (d < 0) return t('widgets.due.overdueSince', { date: shortDate(due) });
	if (d === 0) return t('widgets.due.today');
	if (d === 1) return t('widgets.due.tomorrow');
	return t('widgets.due.until', { date: shortDate(due) });
}

/**
 * Der eine Satz unter dem Titel der Übersicht: das Wichtigste aus „Zu erledigen“.
 * `null`, wenn nichts ansteht.
 */
export function feedFinding(todos: DashboardFeedTodo[], today: string): string | null {
	const overdue = todos.filter((todo) => todo.severity === 'overdue');
	if (overdue.length) {
		const oldest = overdue.reduce((a, b) => ((a.due ?? today) <= (b.due ?? today) ? a : b));
		const days = oldest.due ? daysBetween(oldest.due, today) : 0;
		const since = days >= 1 ? t('widgets.finding.since', { days }) : '';
		if (overdue.length === 1) {
			return since
				? t('widgets.finding.oneOverdueSince', { title: oldest.title, since })
				: t('widgets.finding.oneOverdue', { title: oldest.title });
		}
		return since
			? t('widgets.finding.manyOverdueSince', { count: overdue.length, since })
			: t('widgets.finding.manyOverdue', { count: overdue.length });
	}
	if (!todos.length) return null;
	return t('widgets.finding.upcoming', { count: todos.length });
}
