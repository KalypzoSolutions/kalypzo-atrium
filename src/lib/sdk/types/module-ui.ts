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
	/** Abschnitte auf der Profilseite (`/profile`) */
	profileSections?: ProfileSection[];
}
