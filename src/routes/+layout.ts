import { browser } from '$app/environment';
import { DEFAULT_LOCALE, ensureLocale, isLocale, setClientLocale } from '$lib/i18n';
import type { LayoutLoad } from './$types';

/** Texte der Sprache laden, bevor Komponenten rendern (Deutsch ist immer da). */
export const load: LayoutLoad = async ({ data }) => {
	const locale = isLocale(data.locale) ? data.locale : DEFAULT_LOCALE;
	await ensureLocale(locale);
	// Im Browser global setzen; auf dem Server gilt die Sprache des Requests (AsyncLocalStorage)
	if (browser) setClientLocale(locale);
	return data;
};
