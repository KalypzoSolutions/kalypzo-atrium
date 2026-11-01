import { hasMessage, t } from '$lib/i18n';

/**
 * Texte der Endpunkt-Beschreibung (`summary`, `description`, `tags`, Zod-`describe`): Core-Endpunkte tragen
 * i18n-Schlüssel, die erst beim Ausliefern (API-Übersicht, OpenAPI) in der Sprache des Requests übersetzt
 * werden. Alles andere (z. B. deutsche Texte der Module) bleibt unverändert.
 */
export function endpointText(text: string): string;
export function endpointText(text: string | undefined): string | undefined;
export function endpointText(text: string | null | undefined): string | null | undefined;
export function endpointText(text: string | null | undefined): string | null | undefined {
	return text && hasMessage(text, 'de') ? t(text) : text;
}

/** Übersetzt alle `summary`/`description`-Texte eines (OpenAPI-)Dokuments an Ort und Stelle. */
export function translateDocumentTexts<T>(doc: T, depth = 0): T {
	if (depth > 64 || !doc || typeof doc !== 'object') return doc;
	if (Array.isArray(doc)) {
		for (const item of doc) translateDocumentTexts(item, depth + 1);
		return doc;
	}
	const obj = doc as Record<string, unknown>;
	for (const [k, v] of Object.entries(obj)) {
		if (typeof v === 'string') {
			if (k === 'description' || k === 'summary') obj[k] = endpointText(v);
		} else if (k === 'tags' && Array.isArray(v)) {
			obj[k] = v.map((tag) => (typeof tag === 'string' ? endpointText(tag) : tag));
		} else translateDocumentTexts(v, depth + 1);
	}
	return doc;
}
