import { t } from '$lib/i18n';

/**
 * Beschriftungen als Objekt, dessen Werte erst beim Lesen übersetzt werden (Sprache des Requests bzw. der
 * Seite). So bleiben exportierte Tabellen wie `X_LABELS[key]` nutzbar, ohne die Sprache beim Import einzufrieren.
 */
export function translatedLabels<K extends string>(keys: Record<K, string>): Record<K, string> {
	return Object.defineProperties(
		{} as Record<K, string>,
		Object.fromEntries(
			Object.entries<string>(keys).map(([k, key]) => [k, { enumerable: true, get: () => t(key) }])
		)
	);
}
