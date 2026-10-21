/**
 * Gemeinsame Datumshelfer für Core, Module und Browser (#32). Reine Funktionen ohne Server-Abhängigkeiten.
 *
 * Kalenderdaten sind überall Strings `YYYY-MM-DD`; „heute“ ist **immer** der Kalendertag in Europe/Berlin
 * – unabhängig von der Zeitzone des Servers (Container laufen in UTC) oder des Browsers.
 * Datumsarithmetik (`addDays`, `daysBetween`) rechnet auf reinen Kalenderdaten in UTC (keine Sommerzeit-Sprünge).
 *
 *   import { todayBerlin, addDays, formatDateDe } from '$lib/sdk/dates';
 */

const TIME_ZONE = 'Europe/Berlin';
const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const berlinDay = new Intl.DateTimeFormat('en-CA', {
	timeZone: TIME_ZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

const berlinDateTime = new Intl.DateTimeFormat('de-DE', {
	timeZone: TIME_ZONE,
	dateStyle: 'medium',
	timeStyle: 'short'
});

let todayOverride: string | null = null;

/**
 * Nur für Tests: festes „heute“ (`YYYY-MM-DD`) für **alle** Aufrufe von `todayBerlin()` ohne Argument;
 * `null` hebt die Festlegung auf. Einziger Test-Override für „heute“ im Projekt.
 */
export function setTodayForTests(date: string | null): void {
	if (date !== null && !isRealDate(date)) throw new Error(`Ungültiges Datum: ${date}`);
	todayOverride = date;
}

/**
 * Kalendertag in Europe/Berlin als `YYYY-MM-DD`. Ohne Argument „jetzt“ (bzw. der Test-Override),
 * mit `now` der Tag dieses Zeitpunkts (z. B. `2026-12-31T23:30:00Z` → `2027-01-01`).
 */
export function todayBerlin(now?: Date): string {
	if (!now && todayOverride) return todayOverride;
	const parts = berlinDay.formatToParts(now ?? new Date());
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Echtes Kalenderdatum im Format `YYYY-MM-DD` (kein 31.02., kein 2026-1-5)? */
export function isRealDate(iso: string): boolean {
	const m = ISO_DATE.exec(iso);
	if (!m) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.getUTCFullYear() === Number(m[1]) && isoOf(d) === iso;
}

function isoOf(d: Date): string {
	const y = String(d.getUTCFullYear()).padStart(4, '0');
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

function utcMs(iso: string): number | null {
	const m = ISO_DATE.exec(iso);
	return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** Datum + `days` Kalendertage (negativ = zurück); ungültiges Datum bleibt unverändert. */
export function addDays(iso: string, days: number): string {
	const ms = utcMs(iso);
	if (ms === null || !Number.isFinite(days)) return iso;
	return isoOf(new Date(ms + Math.trunc(days) * DAY_MS));
}

/** Ganze Kalendertage von `a` nach `b` (positiv, wenn `b` später liegt); ungültig → `NaN`. */
export function daysBetween(a: string, b: string): number {
	const x = utcMs(a);
	const y = utcMs(b);
	return x === null || y === null ? Number.NaN : Math.round((y - x) / DAY_MS);
}

/**
 * `2026-03-07` → `07.03.2026`; ein Zeitstempel (`2026-03-07T23:30:00Z`) zählt mit seinem Kalendertag in
 * Europe/Berlin (→ `08.03.2026`). Leer/`null` → `empty`, alles andere unverändert.
 */
export function formatDateDe(value: string | null | undefined, empty = ''): string {
	if (!value) return empty;
	let iso = value;
	if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
		const d = new Date(value);
		if (!Number.isNaN(d.getTime())) iso = todayBerlin(d);
	}
	const m = ISO_DATE.exec(iso);
	return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
}

/**
 * Zeitpunkt (ISO-Zeitstempel oder `Date`) als „21.10.2026, 14:05“ in Europe/Berlin;
 * leer/ungültig → `empty`.
 */
export function formatDateTimeDe(value: string | Date | null | undefined, empty = ''): string {
	if (!value) return empty;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? empty : berlinDateTime.format(d);
}

/**
 * Alter in vollen Jahren am Stichtag `today` (Standard: heute in Europe/Berlin);
 * `null` bei ungültigem Datum. Liegt das Geburtsdatum nach dem Stichtag, ist das Ergebnis negativ.
 */
export function ageFromBirthDate(
	birthDate: string | null | undefined,
	today: string = todayBerlin()
): number | null {
	const b = ISO_DATE.exec(birthDate ?? '');
	const t = ISO_DATE.exec(today);
	if (!b || !t) return null;
	let age = Number(t[1]) - Number(b[1]);
	if (`${t[2]}${t[3]}` < `${b[2]}${b[3]}`) age -= 1;
	return age;
}
