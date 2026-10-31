import type { Component } from 'svelte';

/** Props, die jede Modul-Seitenkomponente erhält (Deklaration optional). */
export interface ModulePageProps {
	/** Werte der `:name`-Segmente des passenden Routenmusters */
	params: Record<string, string>;
	/** Unterpfad innerhalb des Moduls (ohne führende/abschließende Slashes) */
	path: string;
}

/** Props der Komponente eines Profil-Abschnitts */
export interface ProfileSectionProps {
	/** ID des angemeldeten Benutzers (Abschnitte laden ihre Daten selbst per `apiFetch`) */
	userId: string;
}

/**
 * Abschnitt, den ein Modul auf `/profile` beisteuert (nur für aktive Module, nur mit Recht
 * `permission`). Die Komponente lädt ihre Daten selbst; die Durchsetzung der Rechte bleibt serverseitig.
 */
export interface ProfileSection {
	/** `[a-z][a-z0-9-]*`, eindeutig im Modul (global: `<moduleId>:<id>`) */
	id: string;
	title: string;
	/** Sortierung aufsteigend (Standard 100) */
	order?: number;
	/** Nur sichtbar mit diesem Recht (leer = alle angemeldeten Benutzer) */
	permission?: string;
	component: () => Promise<{ default: Component<ProfileSectionProps> }>;
}

/** Props der Komponente eines Abschnitts im Dialog „Benutzer bearbeiten“ (`/admin/users`) */
export interface UserAdminSectionProps {
	/** ID des bearbeiteten Kontos */
	userId: string;
	/** Name des bearbeiteten Kontos (für Texte) */
	userName: string;
}

/**
 * Abschnitt, den ein Modul im Dialog „Benutzer bearbeiten“ der Verwaltung beisteuert (nur aktive Module, nur mit
 * Recht `permission`). Die Komponente lädt und speichert selbst per `apiFetch` (eigener Knopf, unabhängig vom
 * Formular des Dialogs); die Durchsetzung der Rechte bleibt serverseitig.
 */
export interface UserAdminSection {
	/** `[a-z][a-z0-9-]*`, eindeutig im Modul (global: `<moduleId>:<id>`) */
	id: string;
	title: string;
	/** Sortierung aufsteigend (Standard 100) */
	order?: number;
	/** Nur sichtbar mit diesem Recht */
	permission?: string;
	component: () => Promise<{ default: Component<UserAdminSectionProps> }>;
}

/**
 * Vertrag für `src/lib/modules/<id>/ui.ts`: Zuordnung Unterpfad -> Seitenkomponente.
 *
 * Schlüssel sind exakte Unterpfade (`''`, `groups`) oder Muster mit Parametern
 * (`actions/:id`, `actions/:id/edit`). Exakte Treffer haben Vorrang.
 */
export interface ModuleUi {
	/** Seiten hinter dem Login unter `/modules/<id>/<pfad>` */
	routes: Record<
		string,
		() => Promise<{ default: Component<ModulePageProps> | Component<Record<string, never>> }>
	>;
	/**
	 * Öffentliche Seiten ohne Login unter `/p/<id>/<pfad>` (gleiche Muster wie `routes`). Die Seiten
	 * dürfen nur öffentliche Modul-Endpoints (`public: true`) verwenden.
	 */
	publicRoutes?: Record<
		string,
		() => Promise<{ default: Component<ModulePageProps> | Component<Record<string, never>> }>
	>;
	/**
	 * Schlanke Seiten zum Einbetten im iframe unter `/embed/<id>/<pfad>` (gleiche Muster wie `routes`, Login nötig,
	 * ohne Seitenleiste/Kopfzeile, volle Fensterhöhe). Gegenstück zu `ModuleDefinition.embeds` (Server), siehe
	 * `$lib/sdk/types/embeds.ts`. Links in die App mit `target="_top"` öffnen.
	 */
	embedRoutes?: Record<string, () => Promise<{ default: Component<ModulePageProps> }>>;
	/** Abschnitte auf der Profilseite (`/profile`) */
	profileSections?: ProfileSection[];
	/** Abschnitte im Dialog „Benutzer bearbeiten“ der Verwaltung (`/admin/users`) */
	userAdminSections?: UserAdminSection[];
	/** Kacheln auf dem Dashboard (`/dashboard`) */
	dashboardWidgets?: DashboardWidget[];
	/**
	 * Schlüssel aus `routes`, die die ganze Fläche neben Seitenleiste und Kopfzeile nutzen (ohne Rand und
	 * ohne Maximalbreite, Höhe = Fensterhöhe minus Kopfzeile), z. B. Editoren wie das Whiteboard.
	 */
	fullBleedRoutes?: string[];
	/**
	 * Schlüssel aus `publicRoutes`, die auf `/p/<id>/…` die volle Breite bekommen (statt der schmalen Spalte),
	 * z. B. Editoren über öffentliche Links.
	 */
	publicWideRoutes?: string[];
}

/** Breite einer Dashboard-Kachel im Raster: `sm` = 1 Spalte, `md` = 2 Spalten, `lg` = volle Breite */
export type DashboardWidgetSize = 'sm' | 'md' | 'lg';

/**
 * Zustand, den eine Kachel meldet. `empty` = nichts Wichtiges zu zeigen → das Dashboard klappt die
 * Kachel zu einer Zeile „Nichts Neues“ am Ende ein (außer im Anpassen-Modus).
 */
export type DashboardWidgetStatus = 'loading' | 'ready' | 'empty' | 'error';

/** Props der Komponente einer Dashboard-Kachel */
export interface DashboardWidgetProps {
	/** ID des angemeldeten Benutzers (Kacheln laden ihre Daten selbst per `apiFetch`) */
	userId: string;
	size: DashboardWidgetSize;
	/** Zustand melden (nach dem Laden `ready` oder `empty`, bei Fehlern `error`) */
	onstatus?: (status: DashboardWidgetStatus) => void;
}

/**
 * Kachel, die ein Modul auf `/dashboard` beisteuert (nur für aktive Module, nur mit Recht). Die
 * Komponente lädt ihre Daten selbst und nutzt `DashboardCard` aus `$lib/components/layout`; die
 * Durchsetzung der Rechte bleibt serverseitig.
 */
export interface DashboardWidget {
	/** `[a-z][a-z0-9-]*`, eindeutig im Modul (global: `<moduleId>:<id>`) */
	id: string;
	title: string;
	/** Kurzbeschreibung für „Dashboard anpassen“ */
	description?: string;
	/** Standard-Reihenfolge aufsteigend (Standard 100) */
	order?: number;
	/** Standard `sm` */
	size?: DashboardWidgetSize;
	/** Nur sichtbar mit diesem Recht */
	permission?: string;
	/** Nur sichtbar mit mindestens einem dieser Rechte (zusätzlich zu `permission`) */
	anyPermission?: string[];
	/** Standardmäßig ausgeblendet (lässt sich unter „Anpassen“ einschalten) */
	defaultHidden?: boolean;
	component: () => Promise<{ default: Component<DashboardWidgetProps> }>;
}
