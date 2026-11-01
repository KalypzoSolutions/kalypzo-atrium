import type { ModuleManifest, ModuleSettingDefinition, RequestContext } from '$lib/sdk/types';
import type { ApiEndpoint } from '../api/types';
import type { ModuleNotificationType, NotificationScopeEntry } from '$lib/sdk/types/notifications';
import type { AssistFormat, AssistTask } from '$lib/sdk/types/assist';

/** Benachrichtigungstypen eines Moduls (siehe `core.notifications`) */
export interface ModuleNotifications {
	types: ModuleNotificationType[];
	/**
	 * Bereiche der `scoped`-Typen, die die Person im Profil einstellen kann (z. B. ihre Postfächer oder
	 * Ämter). Läuft nur bei aktivem Modul, nie in einer offenen Transaktion; Fehler blenden die Einträge aus.
	 */
	forUser?: (ctx: RequestContext) => Promise<NotificationScopeEntry[]>;
}

/** Eine Textstelle des Moduls, an der die KI-Schreibhilfe erscheint (siehe `core/ai/assist`) */
export interface ModuleAssistPurpose {
	/** Anzeige, z. B. „Aktionsbeschreibung“ */
	label: string;
	/** Wofür der Text ist, Zielgruppe, Besonderheiten – steht im Prompt */
	description: string;
	format: AssistFormat;
	/** Höchstlänge des Feldes (Zeichen, bei `rich` inkl. HTML) */
	maxChars: number;
	tasks: AssistTask[];
	/** Platzhalter, die im Text vorkommen dürfen und unverändert bleiben müssen (z. B. `{{aktion}}`) */
	placeholders?: string[];
	/** Werte, die der Client in `extra` mitschicken darf (ungespeicherte Formularwerte): Schlüssel → Bezeichnung */
	extraKeys?: Record<string, string>;
	/** Tabellen (`table`, `tr`, `th`, `td` …) im HTML erlauben (z. B. Notizen) */
	richTables?: boolean;
	/** Text ist eine Nachricht/ein Brief: Anrede und Grußformel des Stamms verwenden */
	letter?: boolean;
	/** Erlaubte Kontextquellen als `<modul>:<art>`, z. B. `actions:action` */
	contexts?: string[];
}

/** Eckdaten, die ein Kontext-Provider liefert */
export interface ModuleAssistContext {
	/** Kurze Fakten (Name → Wert), werden der Person im Blatt angezeigt */
	facts: Record<string, string>;
	/** Längerer Text (z. B. eingegangene Mail); nur mit `core.ai.assist.allowInbox` */
	document?: string;
	/** Bilder als Data-URL (ohne Metadaten); nur mit `core.ai.assist.allowImages` */
	images?: string[];
}

/** Schreibhilfe eines Moduls: eigene Textstellen und Kontextquellen für alle Module */
export interface ModuleAssist {
	purposes?: Record<string, ModuleAssistPurpose>;
	/**
	 * Kontext je Art (`kind`): prüft selbst den Zugriff mit `ctx` und liefert `null`, wenn die Person das
	 * Objekt nicht sehen darf (→ 404). Läuft außerhalb jeder Transaktion; nur nötige Felder, keine Personendaten.
	 */
	contexts?: Record<
		string,
		(ctx: RequestContext, id: string) => Promise<ModuleAssistContext | null>
	>;
}

export interface ModuleMigration {
	name: string;
	sql: string;
}

/**
 * Serverseitige Moduldefinition. Wird in `modules/<id>/module.ts` per
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
	/**
	 * Wiederherstellen/Zusammenführen dieses Moduls nur für Administrator*innen (#16), weil seine Daten Rechte
	 * verleihen (z. B. Ämter → Rollen). Wert = kurzer Grund für die Anzeige.
	 */
	adminOnlyRestore?: string;
	/**
	 * Eigene Job-IDs (aus `jobs`), die nach dem Wiederherstellen des Moduls abgeleitete Core-Daten neu bilden
	 * (z. B. Rollen-Verleihungen). Laufen nach dem Commit im Systemkontext, nur bei aktivem Modul, best-effort.
	 */
	afterRestoreJobs?: string[];
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

/**
 * Quelle eines Moduls für die Übersicht (`/dashboard`, „Zu erledigen“ bzw. „Diese Woche“). Gleiche
 * Regeln wie `ModuleSearchProvider`: nur bei aktivem Modul und vorhandenem Recht, nie in einer offenen
 * Transaktion aufgerufen; `run` filtert selbst objektbezogen und liefert nur, was die Person in der
 * Moduloberfläche auch sieht. Fehler werden protokolliert und die Quelle übersprungen.
 */
export interface ModuleDashboardSource<TOpts, TItem> {
	permission?: string;
	anyPermission?: string[];
	run: (ctx: RequestContext, opts: TOpts) => Promise<TItem[]>;
}

/** `ModuleDefinition.dashboard` */
export interface ModuleDashboardSources {
	/** Offene Handlungen der Person (höchstens `limit`), `today` = heute in Europe/Berlin */
	todos?: ModuleDashboardSource<
		{ today: string; limit: number },
		import('$lib/sdk/types/dashboard').DashboardTodo
	>;
	/**
	 * Eigene Arten für „Diese Woche“ zusätzlich zu den Core-Arten (`meeting`, `event`, `deadline`), z. B.
	 * `{ key: 'action', label: 'Aktion', style: 'tinted' }`. Einträge dürfen nur Core- oder eigene Arten nutzen.
	 */
	agendaKinds?: import('$lib/sdk/types/dashboard').DashboardAgendaKindInfo[];
	/** Einträge im Zeitraum `from`–`to` (beide inklusive, `YYYY-MM-DD`) */
	agenda?: ModuleDashboardSource<
		{ today: string; from: string; to: string },
		import('$lib/sdk/types/dashboard').DashboardAgendaItem
	>;
}

/**
 * Einbettbare Inhalte eines Moduls (z. B. Whiteboard in einer Notiz, Vertrag in `$lib/sdk/types/embeds.ts`).
 * Der Core ruft `search`/`describe` nur bei aktivem Modul und vorhandenem `permission` auf, nacheinander,
 * nie in einer offenen Transaktion. Beide filtern selbst objektbezogen (nur, was die Person sehen darf).
 * Die Browser-Seite dazu liegt in `ModuleUi.embedRoutes` und wird unter `/embed/<modul>/<path>` im iframe geladen.
 */
export interface ModuleEmbedProvider {
	/** Art innerhalb des Moduls, `[a-z][a-z0-9-]*`, eindeutig je Modul (z. B. `board`) */
	kind: string;
	/** Bezeichnung der Art, z. B. „Whiteboard“ */
	label: string;
	/** Icon-Name aus `components/layout/icons.ts` */
	icon: string;
	/** Nur mit diesem Recht angeboten/aufgelöst (muss bekannt sein) */
	permission?: string;
	/** Treffer für die Auswahl; `query` ist getrimmt, 2–100 Zeichen; höchstens `limit` liefern */
	search: (
		ctx: RequestContext,
		query: string,
		limit: number
	) => Promise<{ refId: string; title: string; subtitle?: string | null }[]>;
	/**
	 * Verweise je Betrachter*in auflösen: nur sichtbare IDs in der Map (Rest = nicht verfügbar).
	 * `path` relativ zur Embed-Route bzw. Modulseite (z. B. `<id>` → `/embed/<modul>/<id>`, `/modules/<modul>/<id>`).
	 */
	describe: (
		ctx: RequestContext,
		ids: readonly string[]
	) => Promise<Map<string, { title: string; canEdit: boolean; path: string }>>;
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
	/**
	 * Inhalt von `atrium-module.json` (Paketbeschreibung, siehe `package/schema.ts`). Pflicht für Module aus dem
	 * Modulverzeichnis; die Registrierung prüft, dass Kennung, Name, Version, Abhängigkeiten und Rechte zum
	 * Manifest passen. Übernahme ins Manifest mit `manifestFromPackage(pkg)` aus `$lib/sdk/server`.
	 */
	package?: unknown;
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
	/**
	 * Dieses Modul ist die **Personenquelle** (Mitglieder und Gruppen) für Freigaben an Principals und meldet
	 * gelöschte Mitglieder (`core.modules.memberDeleted`). `provides` muss dann `PrincipalProvider`
	 * (`$lib/sdk/types/sharing`) erfüllen. Höchstens ein Modul je Installation.
	 */
	principals?: {
		/** Recht, das Mitglieder in Freigabe-Suche/-Anzeige sichtbar macht (sonst nur „Mitglied“) */
		memberViewPermission: string;
	};
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
	/** Übersicht (`/dashboard`): Einträge für „Zu erledigen“ und „Diese Woche“ */
	dashboard?: ModuleDashboardSources;
	/** Einbettbare Inhalte (Auswahl „Einbetten“ in anderen Modulen, Core-Endpunkte `/api/v1/embeds…`) */
	embeds?: ModuleEmbedProvider[];
	/** Benachrichtigungstypen (Kanalwahl E-Mail/Push je Person, Versand über `core.notifications.send`) */
	notifications?: ModuleNotifications;
	/** KI-Schreibhilfe: Textstellen (`purposes`, Recht `<modul>.ai.use`) und Kontextquellen (`contexts`) */
	assist?: ModuleAssist;
	/**
	 * Zahl am Navigationseintrag des Moduls in der Seitenleiste (z. B. ungelesene Mails). Nur für Personen,
	 * die den Eintrag sehen; 0 = kein Zähler. `path` wählt den Eintrag (Standard: erster ohne `admin`).
	 * `count` muss schnell sein (Zeitbudget 1,5 s), Core-Dienste nie in einer offenen Modul-Transaktion.
	 */
	navBadge?: { path?: string; count: (ctx: RequestContext) => Promise<number> };
	onEnable?: (ctx: RequestContext) => Promise<void>;
	onDisable?: (ctx: RequestContext) => Promise<void>;
	/**
	 * Daten des Moduls wurden außerhalb seiner Endpunkte ersetzt (Zurücksetzen, Datensicherung wiederherstellen
	 * oder zusammenführen): Zwischenspeicher im Prozess verwerfen, ohne sie zurückzuschreiben. Läuft nach dem
	 * Commit für alle registrierten Module, auch inaktive.
	 */
	onDataReplaced?: () => Promise<void>;
}

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
export const RESERVED_MODULE_IDS = new Set(['core', 'api', 'auth', 'admin', 'system']);

export function moduleSchemaName(moduleId: string): string {
	return `mod_${moduleId.replace(/-/g, '_')}`;
}
