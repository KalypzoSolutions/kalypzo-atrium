/** Reine Logik des TagInput (ohne DOM), damit sie unit-testbar ist. */

export type TagLimits = { max?: number; maxLength?: number };

export const DEFAULT_MAX_TAGS = 20;
export const DEFAULT_MAX_TAG_LENGTH = 40;

/** Trimmt, fasst Leerräume zusammen und kappt auf `maxLength` Zeichen (Codepoints). */
export function normalizeTag(raw: string, maxLength = DEFAULT_MAX_TAG_LENGTH): string {
	const clean = String(raw ?? '')
		.replace(/\s+/g, ' ')
		.trim();
	const limit = Number.isFinite(maxLength) && maxLength > 0 ? Math.floor(maxLength) : 0;
	if (!limit) return '';
	const chars = Array.from(clean);
	return chars.length > limit ? chars.slice(0, limit).join('').trimEnd() : clean;
}

/** Vergleichsschlüssel (case-insensitiv). */
export function tagKey(tag: string): string {
	return tag.toLocaleLowerCase('de');
}

/** Enthält die Liste den Tag bereits (case-insensitiv)? */
export function hasTag(list: readonly string[], tag: string): boolean {
	const key = tagKey(tag);
	return list.some((t) => tagKey(t) === key);
}

/**
 * Fügt einen Tag hinzu und liefert eine neue Liste. Leere Eingaben, Duplikate (case-insensitiv)
 * und Einträge über `max` werden ignoriert – dann kommt die unveränderte Liste (gleiche Referenz) zurück.
 */
export function addTag(list: readonly string[], raw: string, limits: TagLimits = {}): string[] {
	const max = limits.max ?? DEFAULT_MAX_TAGS;
	const tag = normalizeTag(raw, limits.maxLength ?? DEFAULT_MAX_TAG_LENGTH);
	if (!tag || list.length >= max || hasTag(list, tag)) return list as string[];
	return [...list, tag];
}

/** Fügt mehrere Rohwerte nacheinander hinzu (z. B. eingefügter Text mit Kommas). */
export function addTags(
	list: readonly string[],
	raws: readonly string[],
	limits: TagLimits = {}
): string[] {
	return raws.reduce<string[]>((acc, raw) => addTag(acc, raw, limits), list as string[]);
}
