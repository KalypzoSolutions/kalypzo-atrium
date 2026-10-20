/**
 * Reine Logik für `MonthCalendar.svelte`: Monatsraster (Montag als Wochenbeginn),
 * Spurzuweisung mehrtägiger Termine je Woche, Agenda-Liste, Kontrastfarbe und Formatierung.
 * Alle Daten sind `YYYY-MM-DD`-Strings, Monate `YYYY-MM`; gerechnet wird in UTC (keine Zeitzonen-Sprünge).
 */

export interface CalendarItem {
	id: string;
	title: string;
	color?: string | null;
	/** YYYY-MM-DD */
	startsOn: string;
	startsTime?: string | null;
	endsOn?: string | null;
	endsTime?: string | null;
	/** Teil einer Terminserie (zeigt ein Wiederholungs-Symbol, Beschreibung mit „(Serie)“). */
	recurring?: boolean;
	/** Eindeutiger Schlüssel (z. B. `id:datum` bei Serien-Vorkommen); Standard: `id`. */
	key?: string;
}

/** Eindeutiger Schlüssel eines Termins für `{#each}` (bevorzugt `key`, sonst `id`). */
export function calendarItemKey(item: CalendarItem): string {
	return item.key || item.id;
}

export interface WeekSegment {
	item: CalendarItem;
	/** Spalte 0 (Montag) bis 6 (Sonntag). */
	startCol: number;
	/** Anzahl Tage innerhalb dieser Woche (≥ 1). */
	span: number;
	lane: number;
	/** Termin beginnt vor dieser Woche. */
	continuesBefore: boolean;
	/** Termin endet nach dieser Woche. */
	continuesAfter: boolean;
}

export interface WeekLayout {
	days: string[];
	/** Sichtbare Balken (Spur < maxLanes). */
	segments: WeekSegment[];
	/** Je Spalte: Anzahl ausgeblendeter Termine an diesem Tag. */
	hidden: number[];
}

export interface AgendaDay {
	date: string;
	items: CalendarItem[];
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

export const WEEKDAY_LABELS: readonly string[] = WEEKDAYS_SHORT;
export const MAX_LANES = 3;

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

function toUtc(date: string): Date | null {
	const m = DATE_RE.exec(date);
	if (!m) return null;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return isoOf(d) === date ? d : null;
}

function isoOf(d: Date): string {
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isValidDate(date: string | null | undefined): date is string {
	return typeof date === 'string' && toUtc(date) !== null;
}

export function isValidMonth(month: string | null | undefined): month is string {
	if (typeof month !== 'string') return false;
	const m = MONTH_RE.exec(month);
	return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

/** Lokales Datum (Browser-/Server-Zeitzone) als YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function monthOf(date: string): string {
	return date.slice(0, 7);
}

export function addDays(date: string, days: number): string {
	const d = toUtc(date);
	if (!d) return date;
	d.setUTCDate(d.getUTCDate() + days);
	return isoOf(d);
}

export function shiftMonth(month: string, delta: number): string {
	const m = MONTH_RE.exec(month);
	if (!m) return month;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** Wochentag mit Montag = 0 … Sonntag = 6. */
export function weekdayIndex(date: string): number {
	const d = toUtc(date);
	return d ? (d.getUTCDay() + 6) % 7 : 0;
}

/** 6 Wochen à 7 Tage; erste Zeile enthält den Monatsersten (Montag als Wochenbeginn). */
export function buildMonthGrid(month: string): string[][] {
	const first = `${month}-01`;
	const start = addDays(first, -weekdayIndex(first));
	const weeks: string[][] = [];
	for (let w = 0; w < 6; w++) {
		const week: string[] = [];
		for (let i = 0; i < 7; i++) week.push(addDays(start, w * 7 + i));
		weeks.push(week);
	}
	return weeks;
}

/** Normalisierter Zeitraum eines Termins (Ende < Start oder ungültig → eintägig). */
export function itemRange(item: CalendarItem): { start: string; end: string } | null {
	if (!isValidDate(item.startsOn)) return null;
	const end = isValidDate(item.endsOn) && item.endsOn > item.startsOn ? item.endsOn : item.startsOn;
	return { start: item.startsOn, end };
}

export function isMultiDay(item: CalendarItem): boolean {
	const r = itemRange(item);
	return !!r && r.end !== r.start;
}

/** Sortierung: früher Beginn, dann länger, dann ohne Uhrzeit (ganztägig) zuerst, dann Uhrzeit, dann Titel. */
export function compareItems(a: CalendarItem, b: CalendarItem): number {
	const ra = itemRange(a);
	const rb = itemRange(b);
	if (!ra || !rb) return ra ? -1 : rb ? 1 : 0;
	if (ra.start !== rb.start) return ra.start < rb.start ? -1 : 1;
	if (ra.end !== rb.end) return ra.end > rb.end ? -1 : 1;
	const ta = a.startsTime ?? '';
	const tb = b.startsTime ?? '';
	if (ta !== tb) return ta < tb ? -1 : 1;
	return a.title.localeCompare(b.title, 'de');
}

/**
 * Spurzuweisung für eine Woche (pro Woche neu begonnen): Termine, die die Woche berühren,
 * werden sortiert und jeweils in die niedrigste Spur gelegt, die über ihren Zeitraum frei ist.
 */
export function layoutWeek(
	days: string[],
	items: CalendarItem[],
	maxLanes: number = MAX_LANES
): WeekLayout {
	const weekStart = days[0]!;
	const weekEnd = days[days.length - 1]!;
	const relevant = items
		.filter((it) => {
			const r = itemRange(it);
			return !!r && r.start <= weekEnd && r.end >= weekStart;
		})
		.sort(compareItems);

	// occupied[lane][col]
	const occupied: boolean[][] = [];
	const segments: WeekSegment[] = [];
	const hidden = days.map(() => 0);

	for (const item of relevant) {
		const r = itemRange(item)!;
		const from = r.start < weekStart ? weekStart : r.start;
		const to = r.end > weekEnd ? weekEnd : r.end;
		const startCol = days.indexOf(from);
		const endCol = days.indexOf(to);
		if (startCol < 0 || endCol < 0) continue;
		let lane = 0;
		for (;;) {
			const row = (occupied[lane] ??= days.map(() => false));
			let free = true;
			for (let c = startCol; c <= endCol; c++) if (row[c]) free = false;
			if (free) {
				for (let c = startCol; c <= endCol; c++) row[c] = true;
				break;
			}
			lane++;
		}
		if (lane < maxLanes) {
			segments.push({
				item,
				startCol,
				span: endCol - startCol + 1,
				lane,
				continuesBefore: r.start < weekStart,
				continuesAfter: r.end > weekEnd
			});
		} else {
			for (let c = startCol; c <= endCol; c++) hidden[c]!++;
		}
	}
	return { days, segments, hidden };
}

/** Alle Termine, die einen Tag berühren, sortiert. */
export function itemsOnDay(items: CalendarItem[], date: string): CalendarItem[] {
	return items
		.filter((it) => {
			const r = itemRange(it);
			return !!r && r.start <= date && r.end >= date;
		})
		.sort(compareItems);
}

/**
 * Agenda: Tage des Monats mit mindestens einem Termin. Mehrtägige Termine erscheinen nur **einmal**,
 * am ersten sichtbaren Tag (Beginn bzw. Monatserster, wenn sie vorher beginnen); der Zeitraum steht am Eintrag.
 */
export function buildAgenda(month: string, items: CalendarItem[]): AgendaDay[] {
	if (!isValidMonth(month)) return [];
	const first = `${month}-01`;
	const byDay = new Map<string, CalendarItem[]>();
	for (const item of items) {
		const r = itemRange(item);
		if (!r || r.end < first) continue;
		const date = r.start < first ? first : r.start;
		if (monthOf(date) !== month) continue;
		const list = byDay.get(date);
		if (list) list.push(item);
		else byDay.set(date, [item]);
	}
	return [...byDay.keys()]
		.sort()
		.map((date) => ({ date, items: byDay.get(date)!.sort(compareItems) }));
}

/** Parst `#rgb` / `#rrggbb` (ohne Alpha); sonst null. */
export function parseHexColor(color: string | null | undefined): [number, number, number] | null {
	if (!color) return null;
	const c = color.trim();
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
	if (short)
		return [short[1]!, short[2]!, short[3]!].map((h) => parseInt(h + h, 16)) as [
			number,
			number,
			number
		];
	const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
	if (long)
		return [long[1]!, long[2]!, long[3]!].map((h) => parseInt(h, 16)) as [number, number, number];
	return null;
}

/** Relative Luminanz nach WCAG 2.x (0 = schwarz, 1 = weiß). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
	const lin = (v: number) => {
		const s = v / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Lesbare Schriftfarbe auf einer Hintergrundfarbe: `#ffffff` oder `#111827`, je nachdem,
 * welche den höheren Kontrast hat. Ungültige Farbe → null (Aufrufer nutzt Token-Farben).
 */
export function contrastTextColor(color: string | null | undefined): string | null {
	const rgb = parseHexColor(color);
	if (!rgb) return null;
	const l = relativeLuminance(rgb);
	const dark = relativeLuminance([17, 24, 39]);
	const contrastWhite = 1.05 / (l + 0.05);
	const contrastDark = (l + 0.05) / (dark + 0.05);
	return contrastDark >= contrastWhite ? '#111827' : '#ffffff';
}

/** „Oktober 2026“ */
export function formatMonthLabel(month: string): string {
	const m = MONTH_RE.exec(month);
	if (!m) return month;
	return new Intl.DateTimeFormat('de-DE', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)));
}

/** „Mo, 19.10.“ */
export function formatDayLabel(date: string): string {
	return `${WEEKDAYS_SHORT[weekdayIndex(date)]}, ${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

/** „19.10.“ */
export function formatShortDate(date: string): string {
	return `${date.slice(8, 10)}.${date.slice(5, 7)}.`;
}

/** „Montag, 19. Oktober 2026“ */
export function formatLongDate(date: string): string {
	const d = toUtc(date);
	if (!d) return date;
	return new Intl.DateTimeFormat('de-DE', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(d);
}

/** Zeitangabe eines Termins, z. B. „18:00–20:00“, „ab 18:00“ oder leer. */
export function formatItemTime(item: CalendarItem): string {
	const s = item.startsTime?.slice(0, 5) ?? '';
	const e = item.endsTime?.slice(0, 5) ?? '';
	if (s && e && !isMultiDay(item)) return `${s}–${e}`;
	return s;
}

/** Barrierefreie Beschreibung eines Termins. */
export function describeItem(item: CalendarItem): string {
	const title = item.recurring ? `${item.title} (Serie)` : item.title;
	const r = itemRange(item);
	if (!r) return title;
	const startTime = item.startsTime ? ` ${item.startsTime.slice(0, 5)}` : '';
	const endTime = item.endsTime ? ` ${item.endsTime.slice(0, 5)}` : '';
	if (r.end !== r.start) {
		return `${title}, ${formatLongDate(r.start)}${startTime} bis ${formatLongDate(r.end)}${endTime}`;
	}
	const time = formatItemTime(item);
	return `${title}, ${formatLongDate(r.start)}${time ? `, ${time}` : ''}`;
}
