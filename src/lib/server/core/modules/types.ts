import type { ModuleManifest, ModuleSettingDefinition, RequestContext } from '$lib/sdk/types';
import type { ApiEndpoint } from '../api/types';

export interface ModuleMigration {
	name: string;
	sql: string;
}

/**
 * Serverseitige Moduldefinition. Wird in `src/lib/modules/<id>/module.ts` per
 * `defineModule(...)` exportiert und zur Build-Zeit registriert.
 */
/**
 * Hintergrundjob eines Moduls. Läuft nur, wenn das Modul aktiv ist, mit Systemkontext und
 * höchstens einmal je Intervall (auch bei mehreren Instanzen). Rückgabe = kurze Statusmeldung.
 */
export interface ModuleJob {
	/** `[a-z][a-z0-9-]*`; vollständiger Schlüssel ist `<modul>.<id>` */
	id: string;
	summary: string;
	schedule: 'hourly' | 'daily';
	run: (ctx: RequestContext) => Promise<string | void>;
}

/**
 * Bereich, den Administrator*innen über „Zurücksetzen“ leeren können (siehe `core/system/reset.ts`).
 * Schlüssel nach außen: `<modul>:<id>`.
 */
export interface ResetArea {
	/** `[a-z][a-z0-9-]*`, z. B. `all`, `accounting` */
	id: string;
	label: string;
	description: string;
	/** Tabellen im Modulschema in Löschreihenfolge (abhängige zuerst) */
	tables: string[];
	/** Storage-Präfixe des Moduls, die mit gelöscht werden; `'all'` = alle Dateien des Moduls */
	storagePrefixes?: string[] | 'all';
	/** Bereiche, die zwingend mit zurückgesetzt werden (`<modul>:<id>`, auch fremde Module) */
	implies?: { area: string; reason: string }[];
	/** Statt DELETE: Schema neu aufbauen (DROP SCHEMA + Migrationen erneut), stellt Startdaten wieder her */
	rebuild?: boolean;
}

export interface ModuleDefinition {
	manifest: ModuleManifest;
	settings?: ModuleSettingDefinition[];
	/* eslint-disable @typescript-eslint/no-explicit-any */
	endpoints?: ApiEndpoint<any, any, any>[];
	/* eslint-enable @typescript-eslint/no-explicit-any */
	/** SQL-Migrationen, laufen im PostgreSQL-Schema `mod_<id>` */
	migrations?: ModuleMigration[];
	/**
	 * Dienste, die dieses Modul abhängigen Modulen anbietet (Funktionen; Typvertrag in `contract.ts`
	 * des Moduls). Abruf nur über `core.modules.use(providerId, callerId)`.
	 */
	provides?: Record<string, unknown>;
	/** Hintergrundjobs (siehe `core/jobs`) */
	jobs?: ModuleJob[];
	/**
	 * Standard-Rechte für Rollen (auch in `manifest.defaultRoleGrants` angebbar; Rollenname -> Rechte, Rechte müssen im Manifest stehen). Die Rolle wird
	 * per Name gesucht bzw. angelegt (kein System). Jedes (Modul, Rolle, Recht) wird **einmalig** vergeben
	 * (Marker `role_grant_applied`): bewusst entzogene Rechte kommen nicht zurück.
	 */
	defaultRoleGrants?: Record<string, string[]>;
	/** Bereiche für den Admin-Reset (siehe `ResetArea`) */
	resetAreas?: ResetArea[];
	/**
	 * Beim Zurücksetzen der Benutzer: Verweise auf gelöschte Benutzer bereinigen (läuft in einer
	 * Modul-Transaktion mit `search_path` auf das Modulschema; `keepUserId` = ausführende*r Admin).
	 */
	resetUsers?: (tx: import('../database/client').Tx, keepUserId: string) => Promise<void>;
	onEnable?: (ctx: RequestContext) => Promise<void>;
	onDisable?: (ctx: RequestContext) => Promise<void>;
}

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
export const RESERVED_MODULE_IDS = new Set(['core', 'api', 'auth', 'admin', 'system']);

export function moduleSchemaName(moduleId: string): string {
	return `mod_${moduleId.replace(/-/g, '_')}`;
}
