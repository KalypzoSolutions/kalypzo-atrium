/**
 * Mehrsprachigkeit des Core (Kalypzo Atrium, Phase N) – Client und Server.
 *
 * Texte liegen als JSON je Sprache und Bereich in `messages/<sprache>/<bereich>.json` (verschachtelt oder flach);
 * der Schlüssel im Code ist `<bereich>.<schlüssel>`, z. B. `t('admin-users.title')`. Module bringen eigene Texte in
 * `modules/<id>/messages/<sprache>.json` mit (Bereich = Modul-ID, eingebunden über das Vite-Plugin).
 *
 * Sprache: im Browser die beim Laden gesetzte (`setClientLocale`), auf dem Server die des Requests
 * (`setLocaleResolver`, AsyncLocalStorage in `core/i18n/locale.ts`). Fehlt ein Text, gilt Deutsch, sonst der Schlüssel.
 */
import moduleMessages from 'virtual:atrium-modules/messages';
import { formatMessage, type MessageParams } from './format';

export type { MessageParams } from './format';

export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

/** Namen der Sprachen in ihrer eigenen Sprache (Auswahlfelder) */
export const LOCALE_LABELS: Record<Locale, string> = { de: 'Deutsch', en: 'English' };

/** BCP-47-Tag für `Intl` (Datum, Zahlen, Geld) */
export const INTL_LOCALE: Record<Locale, string> = { de: 'de-DE', en: 'en-GB' };

/** Text, der je Sprache angegeben werden darf (Manifest: Name, Navigation, Rechte) */
export type LocalizedText = string | ({ de: string } & Partial<Record<Locale, string>>);

export function isLocale(v: unknown): v is Locale {
	return typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
}

type Catalog = Record<Locale, Map<string, string>>;
const catalog: Catalog = { de: new Map(), en: new Map() };
const loaded = new Set<Locale>();

function flatten(prefix: string, value: unknown, into: Map<string, string>): void {
	if (typeof value === 'string') {
		into.set(prefix, value);
		return;
	}
	if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) flatten(prefix ? `${prefix}.${k}` : k, v, into);
	}
}

/** Fügt Texte eines Bereichs hinzu (auch für Tests und Module). */
export function addMessages(
	namespace: string,
	locale: Locale,
	messages: Record<string, unknown>
): void {
	flatten(namespace, messages, catalog[locale]);
}

const PATH = /\.\/messages\/([a-z]{2})\/([a-z0-9-]+)\.json$/;

function register(path: string, data: unknown): void {
	const m = PATH.exec(path);
	if (!m || !isLocale(m[1])) return;
	addMessages(m[2]!, m[1], (data ?? {}) as Record<string, unknown>);
}

// Deutsch ist Quelle und Rückfall: immer sofort da. Weitere Sprachen lädt `ensureLocale` nach.
for (const [path, data] of Object.entries(
	import.meta.glob('./messages/de/*.json', { eager: true, import: 'default' })
)) {
	register(path, data);
}
loaded.add('de');

const lazy = import.meta.glob('./messages/*/*.json', { import: 'default' });

for (const [id, byLocale] of Object.entries(moduleMessages)) {
	for (const [locale, data] of Object.entries(byLocale)) {
		if (isLocale(locale)) addMessages(id, locale, data);
	}
}

/** Lädt die Texte einer Sprache (einmalig; Deutsch ist immer geladen). */
export async function ensureLocale(locale: Locale): Promise<void> {
	if (loaded.has(locale)) return;
	const entries = Object.entries(lazy).filter(([p]) => p.startsWith(`./messages/${locale}/`));
	const data = await Promise.all(entries.map(async ([p, load]) => [p, await load()] as const));
	for (const [p, d] of data) register(p, d);
	loaded.add(locale);
}

let clientLocale: Locale = DEFAULT_LOCALE;
let resolver: () => Locale = () => clientLocale;

/** Server: Sprache des laufenden Requests (AsyncLocalStorage). */
export function setLocaleResolver(fn: () => Locale): void {
	resolver = fn;
}

/** Browser: Sprache der Seite (aus den Layout-Daten). */
export function setClientLocale(locale: Locale): void {
	clientLocale = locale;
}

export function getLocale(): Locale {
	return resolver();
}

export function intlLocale(locale: Locale = getLocale()): string {
	return INTL_LOCALE[locale];
}

/** Gibt es den Text in der Sprache (ohne Rückfall)? */
export function hasMessage(key: string, locale: Locale): boolean {
	return catalog[locale].has(key);
}

/** Alle Schlüssel einer Sprache (Tests, Abgleich). */
export function messageKeys(locale: Locale): string[] {
	return [...catalog[locale].keys()];
}

export function rawMessage(key: string, locale: Locale): string | undefined {
	return catalog[locale].get(key);
}

/** Übersetzt in eine bestimmte Sprache (Mails an eine Person, Tests). */
export function tl(locale: Locale, key: string, params?: MessageParams): string {
	const template = catalog[locale].get(key) ?? catalog.de.get(key);
	if (template === undefined) return key;
	return formatMessage(template, params, INTL_LOCALE[locale]);
}

/** Übersetzt in die aktuelle Sprache. */
export function t(key: string, params?: MessageParams): string {
	return tl(getLocale(), key, params);
}

/** Löst einen Text auf, der je Sprache angegeben sein darf. */
export function localized(
	text: LocalizedText | null | undefined,
	locale: Locale = getLocale()
): string {
	if (text === null || text === undefined) return '';
	if (typeof text === 'string') return text;
	return text[locale] ?? text.de;
}

/** Wählt aus `Accept-Language` die beste unterstützte Sprache (sonst `null`). */
export function negotiateLocale(header: string | null | undefined): Locale | null {
	if (!header) return null;
	const ranked = header
		.split(',')
		.map((part, i) => {
			const [tag, ...rest] = part.trim().split(';');
			const q = rest.find((r) => r.trim().startsWith('q='));
			return { tag: (tag ?? '').toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1, i };
		})
		.filter((r) => r.tag && Number.isFinite(r.q) && r.q > 0)
		.sort((a, b) => b.q - a.q || a.i - b.i);
	for (const r of ranked) {
		const base = r.tag.split('-')[0];
		if (isLocale(base)) return base;
	}
	return null;
}
