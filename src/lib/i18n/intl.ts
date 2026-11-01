/**
 * Datum, Zahlen und Geld in der aktuellen Sprache (Phase N). Zeitzone immer Europe/Berlin wie `$lib/sdk/dates`;
 * Kalendertage (`YYYY-MM-DD`) werden ohne Zeitzonenverschiebung formatiert. Für den Core statt fest `de-DE`.
 * Fachmodule (deutsch) dürfen weiter `formatDateDe`/`formatEuro` nutzen.
 */
import { getLocale, intlLocale, type Locale } from './index';

const ZONE = 'Europe/Berlin';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>();

function memo<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(
	key: string,
	make: () => T
): T {
	let f = cache.get(key) as T | undefined;
	if (!f) {
		f = make();
		cache.set(key, f);
	}
	return f;
}

const dateFmt = (l: Locale) =>
	memo(
		`d:${l}`,
		() =>
			new Intl.DateTimeFormat(intlLocale(l), {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
				timeZone: ZONE
			})
	);
const dateUtcFmt = (l: Locale) =>
	memo(
		`du:${l}`,
		() =>
			new Intl.DateTimeFormat(intlLocale(l), {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
				timeZone: 'UTC'
			})
	);
const dateTimeFmt = (l: Locale) =>
	memo(
		`dt:${l}`,
		() =>
			new Intl.DateTimeFormat(intlLocale(l), {
				day: '2-digit',
				month: '2-digit',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				timeZone: ZONE
			})
	);
const timeFmt = (l: Locale) =>
	memo(
		`t:${l}`,
		() =>
			new Intl.DateTimeFormat(intlLocale(l), { hour: '2-digit', minute: '2-digit', timeZone: ZONE })
	);

function toDate(value: string | Date): Date | null {
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Kalendertag (`2026-03-07`) oder Zeitstempel (Tag in Europe/Berlin) → „07.03.2026“ / „07/03/2026“ */
export function formatDate(
	value: string | Date | null | undefined,
	empty = '',
	locale = getLocale()
): string {
	if (!value) return empty;
	if (typeof value === 'string') {
		const m = ISO_DATE.exec(value);
		if (m) return dateUtcFmt(locale).format(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)));
	}
	const d = toDate(value);
	return d ? dateFmt(locale).format(d) : typeof value === 'string' ? value : empty;
}

/** Zeitpunkt → „21.10.2026, 14:05“ (Europe/Berlin) */
export function formatDateTime(
	value: string | Date | null | undefined,
	empty = '',
	locale = getLocale()
): string {
	if (!value) return empty;
	const d = toDate(value);
	return d ? dateTimeFmt(locale).format(d) : empty;
}

/** Uhrzeit eines Zeitpunkts → „14:05“ */
export function formatTime(
	value: string | Date | null | undefined,
	empty = '',
	locale = getLocale()
): string {
	if (!value) return empty;
	const d = toDate(value);
	return d ? timeFmt(locale).format(d) : empty;
}

/** Zahl mit Tausendertrennern; `digits` = feste Nachkommastellen */
export function formatNumber(value: number, digits?: number, locale = getLocale()): string {
	const f = memo(
		`n:${locale}:${digits ?? ''}`,
		() =>
			new Intl.NumberFormat(
				intlLocale(locale),
				digits === undefined ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits }
			)
	);
	return f.format(Number.isFinite(value) ? value : 0);
}

/** Integer-Cent → „1.234,50 €“ / „€1,234.50“ */
export function formatMoney(cents: number, currency = 'EUR', locale = getLocale()): string {
	const f = memo(
		`m:${locale}:${currency}`,
		() => new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency })
	);
	return f.format((Number.isFinite(cents) ? cents : 0) / 100);
}

/** Dateigröße in Byte → „1,2 MB“ */
export function formatBytes(bytes: number, locale = getLocale()): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let v = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${formatNumber(v, i === 0 || v >= 100 ? 0 : 1, locale)} ${units[i]}`;
}

/** „vor 5 Minuten“ / „5 minutes ago“ (ab `now`) */
export function formatRelative(
	value: string | Date,
	now: Date = new Date(),
	locale = getLocale()
): string {
	const d = toDate(value);
	if (!d) return '';
	const f = memo(
		`r:${locale}`,
		() => new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' })
	) as Intl.RelativeTimeFormat;
	const s = Math.round((d.getTime() - now.getTime()) / 1000);
	const abs = Math.abs(s);
	if (abs < 60) return f.format(s, 'second');
	if (abs < 3600) return f.format(Math.round(s / 60), 'minute');
	if (abs < 86400) return f.format(Math.round(s / 3600), 'hour');
	if (abs < 30 * 86400) return f.format(Math.round(s / 86400), 'day');
	if (abs < 365 * 86400) return f.format(Math.round(s / (30 * 86400)), 'month');
	return f.format(Math.round(s / (365 * 86400)), 'year');
}
