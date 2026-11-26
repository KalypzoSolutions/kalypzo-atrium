import { browser } from '$app/environment';
import { DEFAULT_LOCALE, ensureLocale, isLocale, setClientLocale } from '$lib/i18n';
import { setClientBundles } from '$lib/sdk/client/module-ui-registry';
import type { LayoutLoad } from './$types';

/** Texte der Sprache laden, bevor Komponenten rendern (Deutsch ist immer da). */
export const load: LayoutLoad = async ({ data }) => {
	const locale = isLocale(data.locale) ? data.locale : DEFAULT_LOCALE;
	await ensureLocale(locale);
	// Im Browser global setzen; auf dem Server gilt die Sprache des Requests (AsyncLocalStorage)
	if (browser) {
		setClientLocale(locale);
		// Vorkompilierte Modul-Bundles: woher `moduleUiLoader` ihre Oberfläche lädt
		setClientBundles(data.moduleBundles);
	}
	return data;
};
