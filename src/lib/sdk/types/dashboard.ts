/**
 * Übersicht (`/dashboard`): Einträge, die Module für „Zu erledigen“ und „Diese Woche“ liefern
 * (`ModuleDefinition.dashboard`). Der Core sammelt sie über `GET /dashboard/feed`, nur aus aktiven
 * Modulen und nur mit Recht; Module filtern selbst objektbezogen (eigene Datensätze, Freigaben).
 * Client + Server.
 */

/** `overdue` = Frist verstrichen, `due` = bald fällig bzw. zu tun, `info` = Hinweis ohne Druck */
export type DashboardTodoSeverity = 'overdue' | 'due' | 'info';

/** Zahlungsdaten zum Aufklappen in der Zeile (z. B. eigene offene Rechnung) */
export interface DashboardTodoPayment {
	holder: string;
	iban: string;
	bic?: string;
	amountCents: number;
	reference: string;
}

/** Eine Zeile in „Zu erledigen“: genau eine Handlung */
export interface DashboardTodo {
	/** Eindeutig innerhalb des Moduls */
	id: string;
	title: string;
	/** Zweite Zeile, z. B. „R-2026-0142 · Mia und Lukas“ */
	detail?: string;
	/** Frist als `YYYY-MM-DD` (Anzeige „bis 2.11.“ / „seit 20.10. überfällig“) */
	due?: string | null;
	severity: DashboardTodoSeverity;
	/** Betrag rechts in der Zeile (Integer-Cent) */
	amountCents?: number;
	/** Die eine Handlung: relativer App-Pfad */
	action: { label: string; href: string };
	payment?: DashboardTodoPayment;
}

/**
 * Art eines Eintrags in „Diese Woche“: `meeting` = Gruppenstunde, `event` = Termin, `action` = Aktion
 * (Fahrt/Lager), `material` = Materialausgabe/-rückgabe, `deadline` = Frist.
 */
export type DashboardAgendaKind = 'meeting' | 'event' | 'action' | 'material' | 'deadline';

export interface DashboardAgendaItem {
	/** Eindeutig innerhalb des Moduls (bei Serien inkl. Datum) */
	id: string;
	kind: DashboardAgendaKind;
	title: string;
	/** Tag des Eintrags `YYYY-MM-DD`; mehrtägige Einträge mit `endDate` erscheinen an jedem Tag im Zeitraum */
	date: string;
	endDate?: string | null;
	/** Uhrzeit(en) als `HH:MM` (ohne = ganztägig) */
	startTime?: string | null;
	endTime?: string | null;
	/** Kurzer Zusatz, z. B. Gruppe oder „9 Kinder“ */
	detail?: string;
	href: string;
	/** Frist verstrichen und noch offen */
	late?: boolean;
	/**
	 * Zugeordnete Gruppen (`members`-Gruppen-IDs). Eine Gruppenstunde (`meeting`) entfällt, wenn am selben
	 * Tag ein Termin (`event`) derselben Gruppe mit gleicher Startzeit oder gleichem Titel sichtbar ist.
	 */
	groupIds?: string[];
}

export interface DashboardFeedTodo extends DashboardTodo {
	moduleId: string;
	moduleName: string;
}

export interface DashboardFeedAgendaItem extends DashboardAgendaItem {
	moduleId: string;
}

/** Antwort von `GET /dashboard/feed` */
export interface DashboardFeed {
	/** Heute (Europe/Berlin) */
	today: string;
	/** Erster und letzter Tag des Wochenstreifens (Montag–Sonntag der Woche von `today`) */
	from: string;
	to: string;
	todos: DashboardFeedTodo[];
	agenda: DashboardFeedAgendaItem[];
	/** Namen der Module, deren Quelle fehlgeschlagen ist (Anzeige: Hinweis, Rest bleibt nutzbar) */
	failed: string[];
}

export const DASHBOARD_TODO_LIMIT = 30;
export const DASHBOARD_TODO_LIMIT_PER_SOURCE = 10;
export const DASHBOARD_AGENDA_LIMIT = 80;
/** Höchstens so viele Tage fragt der Wochenstreifen ab */
export const DASHBOARD_AGENDA_MAX_DAYS = 14;
