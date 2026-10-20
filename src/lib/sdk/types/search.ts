/**
 * Globale Suche (Befehlspalette oben rechts): Treffer aus Core und Modulen, nur was die Person sehen darf.
 * Client und Server.
 */

/** Ein Suchtreffer. `href` ist ein relativer App-Pfad (beginnt mit `/`, nie `//`). */
export interface SearchHit {
	/** Eindeutig innerhalb der Quelle (z. B. Datensatz-ID) */
	id: string;
	title: string;
	/** Zweite Zeile (z. B. Gruppe, Datum, Ort) – keine sensiblen Daten (Geburtsdatum, IBAN, Gesundheit) */
	subtitle?: string;
	href: string;
	/** Icon-Name aus `components/layout/icons.ts` (unbekannt → Box) */
	icon?: string;
	/** Art des Treffers als Badge, z. B. „Mitglied“, „Gruppe“, „Aktion“ */
	type: string;
}

/** Treffer einer Quelle (Core-Bereich oder Modul) */
export interface SearchGroup {
	/** `core` oder Modul-ID */
	source: string;
	/** Anzeigename der Quelle (Modulname bzw. „Verwaltung“) */
	label: string;
	hits: SearchHit[];
}

export interface SearchResponse {
	query: string;
	groups: SearchGroup[];
}

/** Suchbegriff: 2–100 Zeichen (getrimmt) */
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LENGTH = 100;
/** Höchstens so viele Treffer je Quelle */
export const SEARCH_LIMIT_PER_SOURCE = 5;
