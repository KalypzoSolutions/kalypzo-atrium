import type { Component } from 'svelte';

/** Props, die jede Modul-Seitenkomponente erhaelt (Deklaration optional). */
export interface ModulePageProps {
	/** Werte der `:name`-Segmente des passenden Routenmusters */
	params: Record<string, string>;
	/** Unterpfad innerhalb des Moduls (ohne fuehrende/abschliessende Slashes) */
	path: string;
}

/**
 * Vertrag fuer `src/lib/modules/<id>/ui.ts`: Zuordnung Unterpfad -> Seitenkomponente.
 *
 * Schluessel sind exakte Unterpfade (`''`, `groups`) oder Muster mit Parametern
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
}
