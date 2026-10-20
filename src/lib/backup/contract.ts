/**
 * Datensicherung – gemeinsamer Vertrag für Server (`core/backup`) und UI (`/admin/backup`).
 * Keine Server-Imports. Eingaben der Routen als Zod-Schemas, Antworten als DTO-Typen.
 */
import { z } from 'zod';

export const BACKUP_FORMAT = 'ep-intern-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FILE_EXT = '.epbackup';

export const RESTORE_CONFIRM_WORD = 'WIEDERHERSTELLEN';
export const MERGE_CONFIRM_WORD = 'ZUSAMMENFÜHREN';

/** Mindestlänge des Sicherungs-Passworts */
export const BACKUP_MIN_PASSWORD = 12;
/** Upload in Stücken (bleibt unter `BODY_SIZE_LIMIT`) */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export type RestoreMode = 'restore' | 'merge';

/** `core:<bereich>` oder Modul-ID */
export type BackupScopeKey = string;

export const CORE_SCOPE_KEYS = [
	'core:users',
	'core:roles',
	'core:api-keys',
	'core:settings',
	'core:audit',
	'core:api-log',
	'core:jobs',
	'core:ai-usage'
] as const;

const scopeKey = z
	.string()
	.regex(/^(core:[a-z][a-z0-9-]*|[a-z][a-z0-9-]{1,30})$/, 'Ungültiger Bereich');

const totp = z
	.string()
	.trim()
	.regex(/^\d{6}$/, 'Bitte den 6-stelligen Code eingeben')
	.optional();

// ---------------------------------------------------------------------------
// Eingaben (Routen)
// ---------------------------------------------------------------------------

export const exportInput = z
	.object({
		scopes: z.array(scopeKey).min(1, 'Bitte mindestens einen Bereich wählen').max(100),
		includeFiles: z.boolean(),
		backupPassword: z
			.string()
			.min(BACKUP_MIN_PASSWORD, `Mindestens ${BACKUP_MIN_PASSWORD} Zeichen`)
			.max(200),
		password: z.string().min(1, 'Bitte das Passwort eingeben').max(200),
		totp
	})
	.strict();
export type ExportInput = z.infer<typeof exportInput>;

export const uploadCreateInput = z
	.object({
		size: z.number().int().positive(),
		fileName: z.string().max(200).optional()
	})
	.strict();
export type UploadCreateInput = z.infer<typeof uploadCreateInput>;

export const analyzeInput = z
	.object({
		uploadId: z.string().min(10).max(100),
		backupPassword: z.string().min(1, 'Bitte das Sicherungs-Passwort eingeben').max(200),
		password: z.string().min(1, 'Bitte das Passwort eingeben').max(200),
		totp
	})
	.strict();
export type AnalyzeInput = z.infer<typeof analyzeInput>;

export const executeInput = z
	.object({
		token: z.string().min(10).max(200),
		mode: z.enum(['restore', 'merge']),
		scopes: z.array(scopeKey).min(1, 'Bitte mindestens einen Bereich wählen').max(100),
		/** `core.smtp.*` aus der Sicherung übernehmen (Standard: nein) */
		takeSmtp: z.boolean().default(false),
		/** Aktiv/inaktiv der Module aus der Sicherung übernehmen (nur Wiederherstellen) */
		applyModuleState: z.boolean().default(true),
		confirmWord: z.string().max(50)
	})
	.strict();
export type ExecuteInput = z.infer<typeof executeInput>;

// ---------------------------------------------------------------------------
// Antworten (DTOs)
// ---------------------------------------------------------------------------

export interface BackupScopeInfo {
	key: BackupScopeKey;
	group: 'core' | 'module';
	/** z. B. „Benutzer“ oder Modulname */
	label: string;
	description: string;
	/** Bereiche, die automatisch mitgehen (`key`) */
	implies: { scope: BackupScopeKey; reason: string }[];
	/** Modul aktiv? (Core immer true) */
	enabled: boolean;
}

export interface ExportSummary {
	scopes: BackupScopeKey[];
	tables: number;
	rows: number;
	files: number;
	/** Größe der Sicherungsdatei */
	bytes: number;
	warnings: string[];
}

export interface ExportResult {
	/** Einmaliger Download unter `/admin/backup/export/<downloadId>` (15 min) */
	downloadId: string;
	fileName: string;
	summary: ExportSummary;
}

export interface UploadCreated {
	uploadId: string;
	chunkBytes: number;
}

export interface UploadProgress {
	received: number;
	size: number;
	complete: boolean;
}

export interface PreviewTable {
	/** `schema.tabelle` */
	table: string;
	backupRows: number;
	currentRows: number;
}

export interface PreviewScope {
	key: BackupScopeKey;
	group: 'core' | 'module';
	label: string;
	/** Wiederherstellbar? Sonst `reason` (z. B. „Modul nicht installiert“, „Sicherung ist neuer“) */
	available: boolean;
	reason?: string;
	tables: PreviewTable[];
	files: { count: number; bytes: number };
}

export interface RestorePreview {
	token: string;
	expiresAt: string;
	backup: {
		createdAt: string;
		createdBy: string;
		appVersion: string;
		sourceOrigin: string | null;
		includesFiles: boolean;
	};
	/** Anderer Server-Schlüssel als beim Export (Werte werden neu verschlüsselt, Hashes neu berechnet) */
	secretChanged: boolean;
	scopes: PreviewScope[];
	/**
	 * Kontoschutz beim Wiederherstellen von `core:users`:
	 * `same` = eigenes Konto mit gleichem Passwort in der Sicherung, `kept` = eigenes Konto bleibt zusätzlich erhalten.
	 */
	account: { case: 'same' | 'kept'; willLogout: boolean; twoFactorInBackup: boolean };
	/** Benutzer-IDs in Moduldaten, die es im Ziel (nach Zusammenführen) nicht gibt */
	missingUserRefs: number;
	warnings: string[];
}

export interface RestoreResult {
	mode: RestoreMode;
	scopes: BackupScopeKey[];
	inserted: number;
	deleted: number;
	/** übersprungene Zeilen je Tabelle (Konflikt oder fehlender Bezug) */
	skipped: Record<string, number>;
	files: { uploaded: number; skipped: number; failed: number };
	rehash: { updated: number; unrecoverable: number };
	/** Eigene Sitzung beendet → neu anmelden */
	loggedOut: boolean;
	warnings: string[];
}

export interface RunStatus {
	runId: string;
	state: 'running' | 'done' | 'failed';
	/** Anzeigetext der aktuellen Phase, z. B. „Dateien hochladen“ */
	phase: string;
	progress: { done: number; total: number };
	result?: RestoreResult;
	error?: string;
}
