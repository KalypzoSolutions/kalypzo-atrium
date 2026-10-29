/**
 * Einbetten von Modul-Inhalten in andere Module (z. B. Whiteboard in einer Notiz). Client + Server.
 *
 * Ein Modul bietet Einbettungen über `ModuleDefinition.embeds` (Server: Suche/Beschreibung je Betrachter*in) und
 * `ModuleUi.embedRoutes` (Browser: schlanke Seite unter `/embed/<modul>/<pfad>`, im iframe geladen) an.
 * Gespeichert wird beim Einbettenden nur `{ module, kind, refId }`; Zugriff prüft immer das anbietende Modul.
 *
 * Core-Endpunkte (nur Anmeldung, je Modul dessen `permission`):
 *   GET  /api/v1/embeds?q=…               → `EmbedHit[]` (ab 2 Zeichen, je Art ≤ 10)
 *   POST /api/v1/embeds/describe { items } → `EmbedInfo[]` (gleiche Reihenfolge, unbekannt/kein Zugriff → `available: false`)
 */

/** Verweis auf einen einbettbaren Inhalt */
export interface EmbedRef {
	module: string;
	kind: string;
	refId: string;
}

/** Suchtreffer für die Auswahl „Einbetten“ */
export interface EmbedHit extends EmbedRef {
	title: string;
	subtitle: string | null;
	/** Icon-Name aus `components/layout/icons.ts` */
	icon: string;
	/** Bezeichnung der Art, z. B. „Whiteboard“ */
	kindLabel: string;
}

/** Aufgelöster Verweis (je Betrachter*in) */
export interface EmbedInfo extends EmbedRef {
	available: boolean;
	title: string;
	icon: string;
	kindLabel: string;
	/** Seite im iframe, z. B. `/embed/whiteboard/<id>` (nur wenn `available`) */
	embedPath: string | null;
	/** Vollansicht in der App, z. B. `/modules/whiteboard/<id>` */
	openHref: string | null;
	canEdit: boolean;
}

/** Art eines Moduls in der Auswahl (`GET /api/v1/embeds/kinds`) */
export interface EmbedKind {
	module: string;
	kind: string;
	label: string;
	icon: string;
}
