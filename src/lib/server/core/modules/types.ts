import type { ModuleManifest, ModuleSettingDefinition, RequestContext } from '$lib/sdk/types';
import type { ApiEndpoint } from '../api/types';
import type { ModuleNotificationType, NotificationScopeEntry } from '$lib/sdk/types/notifications';

/** Benachrichtigungstypen eines Moduls (siehe `core.notifications`) */
export interface ModuleNotifications {
	types: ModuleNotificationType[];
	/**
	 * Bereiche der `scoped`-Typen, die die Person im Profil einstellen kann (z. B. ihre Postfächer oder
	 * Ämter). Läuft nur bei aktivem Modul, nie in einer offenen Transaktion; Fehler blenden die Einträge aus.
	 */
	forUser?: (ctx: RequestContext) => Promise<NotificationScopeEntry[]>;
}

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
	/**
	 * `hourly`, `daily` (Zeitfenster) oder `{ everyMinutes }` (1–60) für kurze Abstände, z. B. Postfach-Abruf.
	 * Der Zeitgeber prüft jede Minute; Intervall-Jobs laufen frühestens nach Ablauf des Abstands erneut.
	 */
	schedule: 'hourly' | 'daily' | { everyMinutes: number };
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

/** Helfer für `ModuleBackupHooks.rehash` – Schlüssel des Zielservers für dieses Modul */
export interface ModuleBackupRehashHelpers {
	/** wie `core.crypto.forModule(id).hash` */
	hash(value: string): string;
	/** wie `core.crypto.forModule(id).decrypt` (wirft bei nicht entschlüsselbaren Werten) */
	decrypt(value: string): string;
}

export interface ModuleBackupHooks {
	/**
	 * Nach Wiederherstellen/Zusammenführen in derselben Transaktion (`search_path` = Modulschema):
	 * schlüsselgebundene Hashes (`core.crypto.forModule(id).hash`) mit dem Schlüssel des Zielservers neu
	 * berechnen. Muss idempotent sein; keine Core-Service-Aufrufe.
	 */
	rehash?: (
		tx: import('../database/client').Tx,
		helpers: ModuleBackupRehashHelpers
	) => Promise<{ updated: number; unrecoverable: number }>;
}

/**
 * Suchquelle eines Moduls für die globale Suche. Der Core ruft `run` nur bei aktivem Modul und
 * vorhandenem Recht auf (`permission` und/oder mindestens eines aus `anyPermission`), nacheinander,
 * nie in einer offenen Transaktion. `run` muss selbst objektbezogen filtern (Freigaben, eigene
 * Datensätze) und darf nur Felder liefern, die die Person in der Moduloberfläche auch sieht.
 * Fehler werden protokolliert und die Quelle übersprungen.
 */
export interface ModuleSearchProvider {
	permission?: string;
	anyPermission?: string[];
	/** `query` ist getrimmt, 2–100 Zeichen; höchstens `limit` Treffer liefern */
	run: (
		ctx: RequestContext,
		query: string,
		limit: number
	) => Promise<import('$lib/sdk/types/search').SearchHit[]>;
}

/** Angaben für `ModuleDefinition.onUserDeleted` */
export interface UserDeletedInfo {
	/** ID des gelöschten Kontos (die Core-Zeile existiert nicht mehr) */
	userId: string;
	/**
	 * Konto der löschenden Person – Ziel für Daten, die nicht gelöscht, sondern übergeben werden
	 * (z. B. Eigentum an Terminen). `null` bei Systemaufrufen.
	 */
	transferTo: string | null;
}

/** Rückgabe von `ModuleDefinition.onUserDeleted` */
export interface UserDeletedResult {
	/** Läuft nach dem Commit der Modul-Transaktion (z. B. Storage-Objekte entfernen, Core-Services) */
	afterCommit?: () => Promise<void>;
}

/** Angaben für `ModuleDefinition.onMemberDeleted` */
export interface MemberDeletedInfo {
	/** IDs der gelöschten bzw. anonymisierten Mitglieder (Modul `members`) */
	memberIds: string[];
	/** `deleted` = Datensatz entfernt, `anonymized` = Datensatz bleibt ohne Personenbezug */
	reason: 'deleted' | 'anonymized';
}

/**
 * Betroffene Person einer Datenauskunft (Art. 15/20 DSGVO): ein Benutzerkonto und/oder Mitglieder.
 * `ModuleSubjectExport.resolve` darf weitere Kennungen ergänzen (z. B. `members`: verknüpfte Mitglieder).
 */
export interface DataSubject {
	userId: string | null;
	memberIds: string[];
}

/** Treffer von `ModuleSubjectExport.findSubjects` (Anzeige auf `/admin/privacy`) */
export interface SubjectCandidate {
	label: string;
	detail?: string;
	subject: Partial<DataSubject>;
}

/**
 * Beitrag eines Moduls zur Datenauskunft (`/admin/privacy`). Läuft nur bei aktivem Modul, nie in
 * einer offenen Transaktion, ohne Rechteprüfung (die macht der Core: `core.privacy.export`).
 * `run` liefert alle personenbezogenen Daten der Person im Modul als JSON (Klartext, keine
 * Dateiinhalte, keine Daten Dritter) oder `null`, wenn es nichts gibt.
 */
export interface ModuleSubjectExport {
	/** Personen ohne (bzw. zusätzlich zum) Konto finden, z. B. `members`: Mitglieder nach Name */
	findSubjects?: (query: string, limit: number) => Promise<SubjectCandidate[]>;
	resolve?: (subject: DataSubject) => Promise<Partial<DataSubject>>;
	run: (subject: DataSubject) => Promise<Record<string, unknown> | null>;
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
	 * des Moduls). Abruf nur über `core.modules.use(providerId, callerId)`. Angabe mit
	 * `satisfies <Vertrag>` (kein `as unknown as`), damit fehlende Methoden beim Typcheck auffallen.
	 */
	provides?: object;
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
	/**
	 * Ein Benutzerkonto wurde gelöscht (`deleteUser`): Daten der Person im Modul löschen oder bewusst
	 * übergeben. Läuft NACH dem Löschen der Core-Zeile je **aktivem** Modul in einer eigenen
	 * Modul-Transaktion (`search_path` = Modulschema, keine Core-Services darin aufrufen). Arbeit, die
	 * außerhalb der Transaktion laufen muss (Storage-Objekte entfernen, Core-Services), gehört in
	 * `afterCommit`. Fehler werden je Modul protokolliert und brechen das Löschen nicht ab.
	 */
	onUserDeleted?: (
		tx: import('../database/client').Tx,
		info: UserDeletedInfo
	) => Promise<UserDeletedResult | void>;
	/**
	 * Mitglieder (Modul `members`) wurden gelöscht oder anonymisiert: Kopien ihrer Daten im Modul
	 * löschen bzw. anonymisieren. Ausgelöst von `members` über `core.modules.memberDeleted`; läuft
	 * wie `onUserDeleted` je aktivem Modul in einer eigenen Modul-Transaktion (keine Core-Services
	 * darin; dafür `afterCommit`). Fehler werden je Modul protokolliert.
	 */
	onMemberDeleted?: (
		tx: import('../database/client').Tx,
		info: MemberDeletedInfo
	) => Promise<UserDeletedResult | void>;
	/** Datenauskunft (Art. 15/20 DSGVO, siehe `core/privacy`) */
	subjectExport?: ModuleSubjectExport;
	/** Datensicherung (siehe `core/backup`) */
	backup?: ModuleBackupHooks;
	/** Globale Suche (Befehlspalette): Datensätze des Moduls, die die Person sehen darf */
	search?: ModuleSearchProvider;
	/** Benachrichtigungstypen (Kanalwahl E-Mail/Push je Person, Versand über `core.notifications.send`) */
	notifications?: ModuleNotifications;
	/**
	 * Zahl am Navigationseintrag des Moduls in der Seitenleiste (z. B. ungelesene Mails). Nur für Personen,
	 * die den Eintrag sehen; 0 = kein Zähler. `path` wählt den Eintrag (Standard: erster ohne `admin`).
	 * `count` muss schnell sein (Zeitbudget 1,5 s), Core-Dienste nie in einer offenen Modul-Transaktion.
	 */
	navBadge?: { path?: string; count: (ctx: RequestContext) => Promise<number> };
	onEnable?: (ctx: RequestContext) => Promise<void>;
	onDisable?: (ctx: RequestContext) => Promise<void>;
}

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
export const RESERVED_MODULE_IDS = new Set(['core', 'api', 'auth', 'admin', 'system']);

export function moduleSchemaName(moduleId: string): string {
	return `mod_${moduleId.replace(/-/g, '_')}`;
}
