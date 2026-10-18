/**
 * Vertrag der API-Übersicht (`/api-docs`): Katalog aller REST-Endpunkte, automatisch aus der
 * Endpunkt-Registry erzeugt. Client und Server – hier keine Server-Imports.
 */

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Zugriffsart: anonym erreichbar, nur Anmeldung oder konkrete Berechtigung */
export type ApiAccess = 'public' | 'authenticated' | 'permission';

/** JSON-Schema (Teilmenge, wie von zod-to-openapi / OpenAPI 3.1 erzeugt; `$ref` bereits aufgelöst) */
export interface JsonSchema {
	type?: string | string[];
	title?: string;
	description?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean | JsonSchema;
	items?: JsonSchema;
	enum?: unknown[];
	const?: unknown;
	default?: unknown;
	examples?: unknown[];
	format?: string;
	pattern?: string;
	minimum?: number;
	maximum?: number;
	exclusiveMinimum?: number;
	exclusiveMaximum?: number;
	minLength?: number;
	maxLength?: number;
	minItems?: number;
	maxItems?: number;
	nullable?: boolean;
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	allOf?: JsonSchema[];
	[key: string]: unknown;
}

/** Mögliche Fehlerantwort eines Endpunkts (`{ error: { code, message } }`) */
export interface ApiErrorInfo {
	status: number;
	/** `error.code`, z. B. `validation_failed`, `forbidden` (siehe `core/errors.ts`) */
	code: string;
	/** Wann der Fehler auftritt (deutsch, UI-Text mit Umlauten) */
	when: string;
}

export interface ApiRateLimit {
	limit: number;
	windowSec: number;
	/** true = kein eigenes `rateLimit`, es gilt der Standard des Routers */
	isDefault: boolean;
}

export interface ApiCatalogEntry {
	/** Stabiler Schlüssel `METHOD <Pfad ohne /api/v1>`, z. B. `GET /users/:id` */
	id: string;
	method: ApiMethod;
	/** Vollständiger Pfad inkl. `/api/v1`, Parameter als `:name` */
	path: string;
	/** `core` oder Modul-ID */
	moduleId: string;
	/** Anzeigename des Moduls bzw. „Core“ */
	moduleName: string;
	/** Core immer true; deaktivierte Module liefern 404 `module_disabled` */
	moduleEnabled: boolean;
	/** Gruppen-ID (siehe `ApiCatalog.groups`): Core-Tag bzw. `module:<id>` */
	group: string;
	summary: string;
	description: string | null;
	access: ApiAccess;
	permission: string | null;
	/** Nur mit Session, nie per API-Key */
	sessionOnly: boolean;
	/** Darf der aktuelle Benutzer den Endpunkt aufrufen (Recht vorhanden bzw. kein Recht nötig) */
	allowed: boolean;
	rateLimit: ApiRateLimit;
	multipart: { maxBytes: number; maxFiles: number } | null;
	params: JsonSchema | null;
	query: JsonSchema | null;
	body: JsonSchema | null;
	/** Schema der `data`-Nutzlast (ohne `{ data }`-Hülle); null = nicht dokumentiert */
	response: JsonSchema | null;
	/** POST → 201, sonst 200 (Handler mit eigener Response können abweichen) */
	successStatus: 200 | 201;
	errors: ApiErrorInfo[];
}

export interface ApiCatalogGroup {
	id: string;
	label: string;
}

export interface ApiCatalog {
	/** ISO-Zeitstempel der Erzeugung */
	generatedAt: string;
	entries: ApiCatalogEntry[];
	/** Reihenfolge: Core-Gruppen zuerst, dann Module alphabetisch */
	groups: ApiCatalogGroup[];
}

/* Filter (src/lib/api-docs/filter.ts) */
export interface ApiCatalogFilter {
	search?: string;
	moduleId?: string | null;
	method?: ApiMethod | null;
	/** 'session' = nur `sessionOnly` */
	access?: ApiAccess | 'session' | null;
	onlyAllowed?: boolean;
}

/* Konsole (src/lib/api-docs/console.ts) */
export interface ConsoleRequestInput {
	method: ApiMethod;
	/** Pfad mit `:name`-Platzhaltern */
	path: string;
	params: Record<string, string>;
	query: Record<string, string>;
	/** Roher JSON-Text aus dem Editor (leer = kein Body) */
	bodyText: string;
}

export type ConsoleRequestBuild =
	| {
			ok: true;
			url: string;
			init: { method: ApiMethod; headers: Record<string, string>; body?: string };
	  }
	| { ok: false; error: string; field?: string };

export interface ConsoleResult {
	status: number;
	durationMs: number;
	requestId: string | null;
	rateLimitRemaining: string | null;
	contentType: string | null;
	/** Formatierter Body (JSON eingerückt, sonst Text, gekürzt) */
	bodyText: string;
}

/*
 * Komponenten-Props (src/routes/(internal)/api-docs/):
 *   +page.svelte          data: { catalog: ApiCatalog }
 *   EndpointSheet.svelte  { entry: ApiCatalogEntry | null; open: boolean (bindable) }
 *   SchemaTree.svelte     { schema: JsonSchema; emptyText?: string }
 *   ErrorsTable.svelte    { errors: ApiErrorInfo[] }
 *   ResponsePanel.svelte  { entry: ApiCatalogEntry }
 *   ApiConsole.svelte     { entry: ApiCatalogEntry }
 */
