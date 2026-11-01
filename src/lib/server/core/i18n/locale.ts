/**
 * Sprache je Request auf dem Server (AsyncLocalStorage). `t()` aus `$lib/i18n` liest sie über den hier
 * gesetzten Resolver – auch beim SSR der Svelte-Komponenten, in Fehlertexten (`errors.*`) und Zod-Meldungen.
 *
 * Reihenfolge: Konto-Einstellung `core.user.locale` → Cookie `locale` (Login, öffentliche Seiten) →
 * `core.system.locale` (`auto` = Browser über `Accept-Language`) → Deutsch.
 * Außerhalb eines Requests (Jobs, Mails aus Hintergrundläufen) gilt die Systemsprache.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq } from 'drizzle-orm';
import {
	DEFAULT_LOCALE,
	ensureLocale,
	isLocale,
	LOCALES,
	negotiateLocale,
	setLocaleResolver,
	type Locale
} from '$lib/i18n';
import { getDb, schema } from '../database/client';

export const LOCALE_COOKIE = 'locale';
export type SystemLocale = Locale | 'auto';

const storage = new AsyncLocalStorage<Locale>();
let systemLocale: SystemLocale = 'auto';
let installed = false;

/** Registriert den Resolver und lädt alle Sprachen (einmal beim Start). */
export async function installServerLocale(): Promise<void> {
	if (!installed) {
		setLocaleResolver(() => storage.getStore() ?? fallbackLocale());
		installed = true;
	}
	await Promise.all(LOCALES.map((l) => ensureLocale(l)));
}

/** Systemsprache ohne Request: feste Einstellung oder Deutsch. */
export function fallbackLocale(): Locale {
	return systemLocale === 'auto' ? DEFAULT_LOCALE : systemLocale;
}

/** Vom Einstellungsdienst nach dem Lesen/Ändern von `core.system.locale` aufgerufen. */
export function setSystemLocaleCache(value: unknown): void {
	systemLocale = isLocale(value) ? value : 'auto';
}

export function currentSystemLocale(): SystemLocale {
	return systemLocale;
}

/** Führt `fn` in einer bestimmten Sprache aus (Request, Mail an eine Person). */
export function withLocale<T>(locale: Locale, fn: () => T): T {
	return storage.run(locale, fn);
}

const USER_TTL_MS = 10_000;
const userCache = new Map<string, { locale: Locale | null; at: number }>();

/** Sprache aus der Konto-Einstellung (kurz gecacht; `null` = nicht gewählt). */
export async function userLocale(userId: string): Promise<Locale | null> {
	const hit = userCache.get(userId);
	if (hit && Date.now() - hit.at < USER_TTL_MS) return hit.locale;
	const [row] = await getDb()
		.select({ value: schema.setting.value })
		.from(schema.setting)
		.where(and(eq(schema.setting.key, 'core.user.locale'), eq(schema.setting.scopeId, userId)));
	const locale = isLocale(row?.value) ? row.value : null;
	userCache.set(userId, { locale, at: Date.now() });
	if (userCache.size > 5000) userCache.clear();
	return locale;
}

/** Nach dem Speichern der eigenen Sprache aufrufen. */
export function invalidateUserLocale(userId: string): void {
	userCache.delete(userId);
}

/** Sprache für mehrere Konten (Benachrichtigungen): fehlt die Wahl, gilt die Systemsprache. */
export async function localesForUsers(userIds: string[]): Promise<Map<string, Locale>> {
	const out = new Map<string, Locale>();
	for (const id of userIds) out.set(id, (await userLocale(id)) ?? fallbackLocale());
	return out;
}

export interface LocaleSources {
	userId?: string | null;
	cookie?: string | null;
	acceptLanguage?: string | null;
}

export async function resolveLocale(src: LocaleSources): Promise<Locale> {
	if (src.userId) {
		const own = await userLocale(src.userId);
		if (own) return own;
	}
	if (isLocale(src.cookie)) return src.cookie;
	if (systemLocale !== 'auto') return systemLocale;
	return negotiateLocale(src.acceptLanguage) ?? DEFAULT_LOCALE;
}

export function resetLocaleForTests(): void {
	userCache.clear();
	systemLocale = 'auto';
}
