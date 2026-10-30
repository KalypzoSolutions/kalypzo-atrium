/**
 * Datensicherung – Server-Vertrag zwischen den Bausteinen (envelope, archive, introspect, scopes,
 * secrets, export, restore). Öffentliche DTOs/Eingaben stehen in `$lib/backup/contract`.
 *
 * Datei `.epbackup` = verschlüsselte Hülle (envelope.ts) um ein ZIP (archive.ts) mit:
 *   backup.json                      → `BackupMeta` (immer der erste Eintrag)
 *   data/<schema>.<tabelle>.ndjson   → je Zeile `row_to_json` (Secrets als `SecretMarker`)
 *   files/<objectKey>                → Rohbytes aus dem Speicher
 *   checksums.json                   → `Checksums` (immer der letzte Eintrag)
 */
import { z } from 'zod';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from '$lib/backup/contract';

export * from '$lib/backup/contract';

// ---------------------------------------------------------------------------
// Grenzen
// ---------------------------------------------------------------------------

export const BACKUP_LIMITS = {
	/** Größte Sicherungsdatei (Upload); überschreibbar per `BACKUP_MAX_BYTES` */
	maxFileBytes: 4 * 1024 ** 3,
	/** Klartext-Chunk der Hülle */
	envelopeChunkBytes: 1024 * 1024,
	/** Zeilen je Export-/Insert-Batch */
	rowBatch: 500,
	/** größte einzelne ndjson-Zeile (z. B. Notiz-Versionen als bytea, Whiteboard-Inhalte) */
	maxLineBytes: 128 * 1024 ** 2,
	/** Beim Einfügen spätestens nach so vielen Bytes Zeilentext in die Datenbank schreiben */
	insertBatchBytes: 32 * 1024 ** 2,
	maxEntries: 500_000,
	/** entpackte Gesamtgröße (Zip-Bomb-Schutz) */
	maxUnpackedBytes: 64 * 1024 ** 3,
	/** größter einzelner Eintrag (Datei) */
	maxEntryBytes: 2 * 1024 ** 3,
	/** Zeilen einer Tabelle mit Eigenbezug, die zum Sortieren im Speicher gehalten werden */
	maxSelfRefRows: 500_000,
	/** Gültigkeit von Vorschau-, Upload- und Download-Token */
	tokenTtlMs: 15 * 60_000,
	uploadTtlMs: 60 * 60_000,
	/** Temp-Dateien älter als das werden weggeräumt */
	tempMaxAgeMs: 60 * 60_000
} as const;

/** Erlaubte Einträge im ZIP (alles andere → Abbruch) */
export const ENTRY_META = 'backup.json';
export const ENTRY_CHECKSUMS = 'checksums.json';
export const ENTRY_DATA = /^data\/([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\.ndjson$/;
export const ENTRY_FILE = /^files\/([a-z][a-z0-9-]*\/[A-Za-z0-9-]{1,64})$/;

export const dataEntryName = (schema: string, table: string) => `data/${schema}.${table}.ndjson`;
export const fileEntryName = (objectKey: string) => `files/${objectKey}`;

// ---------------------------------------------------------------------------
// Metadaten
// ---------------------------------------------------------------------------

export const backupColumn = z.object({ name: z.string(), type: z.string() }).strict();

export const backupTableMeta = z
	.object({
		/** `schema.tabelle` */
		name: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/),
		scope: z.string(),
		columns: z.array(backupColumn),
		primaryKey: z.array(z.string()),
		rows: z.number().int().nonnegative()
	})
	.strict();
export type BackupTableMeta = z.infer<typeof backupTableMeta>;

export const backupMeta = z
	.object({
		format: z.literal(BACKUP_FORMAT),
		formatVersion: z.literal(BACKUP_FORMAT_VERSION),
		createdAt: z.string(),
		appVersion: z.string(),
		sourceOrigin: z.string().nullable(),
		createdBy: z.object({ id: z.string(), name: z.string() }).strict(),
		scopes: z.array(z.string()),
		includesFiles: z.boolean(),
		/** angewendete Core-Migrationen (drizzle: Hash) */
		coreMigrations: z.array(z.string()),
		modules: z.record(
			z.string(),
			z
				.object({
					name: z.string(),
					installedVersion: z.string().nullable(),
					enabled: z.boolean(),
					migrations: z.array(z.object({ name: z.string(), checksum: z.string() }).strict())
				})
				.strict()
		),
		/** in Einfüge-Reihenfolge (FK-Eltern zuerst) */
		tables: z.array(backupTableMeta),
		files: z.object({ count: z.number().int(), bytes: z.number() }).strict(),
		/** `keyedHash(KEY_CHECK_INPUT, 'backup')` des Quellservers → Schlüsselwechsel erkennen */
		keyCheck: z.string()
	})
	.strict();
export type BackupMeta = z.infer<typeof backupMeta>;

export const KEY_CHECK_INPUT = 'ep-backup-key-check';

export const checksums = z
	.object({
		entries: z.record(
			z.string(),
			z
				.object({
					sha256: z.string().regex(/^[0-9a-f]{64}$/),
					bytes: z.number().int().nonnegative(),
					rows: z.number().int().nonnegative().optional()
				})
				.strict()
		)
	})
	.strict();
export type Checksums = z.infer<typeof checksums>;

// ---------------------------------------------------------------------------
// Datenbank-Struktur
// ---------------------------------------------------------------------------

export interface ColumnInfo {
	name: string;
	/** `format_type`, z. B. `text`, `jsonb`, `timestamp with time zone`, `text[]` */
	type: string;
	nullable: boolean;
}

export interface ForeignKeyInfo {
	columns: string[];
	refSchema: string;
	refTable: string;
	refColumns: string[];
}

export interface TableInfo {
	schema: string;
	table: string;
	columns: ColumnInfo[];
	primaryKey: string[];
	foreignKeys: ForeignKeyInfo[];
}

/** Tabelle (bzw. Teilmenge) eines Bereichs, wie sie exportiert/wiederhergestellt wird */
export interface PlannedTable {
	scope: string;
	schema: string;
	table: string;
	/**
	 * Zeilenfilter als SQL-Fragment (nur aus Konstanten bzw. geprüften Modul-IDs gebaut), z. B.
	 * `scope_id = ''` für `public.setting` in `core:settings` oder `module_id = 'members'` für `public.file`.
	 * Gilt für Export, Zählen und Löschen beim Wiederherstellen.
	 */
	where?: string;
}

// ---------------------------------------------------------------------------
// Geheimnisse
// ---------------------------------------------------------------------------

export type SecretPurpose = 'settings' | 'better-auth' | `module:${string}`;

/** Entschlüsselter Wert im (verschlüsselten) Archiv; beim Import neu verschlüsselt */
export interface SecretMarker {
	$secret: { p: SecretPurpose; v: string };
}

export function isSecretMarker(v: unknown): v is SecretMarker {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
	const s = (v as { $secret?: unknown }).$secret;
	if (!s || typeof s !== 'object') return false;
	const o = s as { p?: unknown; v?: unknown };
	return typeof o.p === 'string' && typeof o.v === 'string' && Object.keys(v).length === 1;
}

// ---------------------------------------------------------------------------
// Ströme
// ---------------------------------------------------------------------------

/** Byte-Senke (z. B. Datei, Verschlüsselung, ZIP) */
export interface ByteSink {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<void>;
}

export type ByteSource = AsyncIterable<Uint8Array>;

/** Fehler beim Lesen einer Sicherung (wird zu 422 mit diesem Text) */
export class BackupFormatError extends Error {
	constructor(
		readonly code: 'wrong_password' | 'corrupt' | 'unsupported' | 'too_large' | 'invalid_entry',
		message: string
	) {
		super(message);
		this.name = 'BackupFormatError';
	}
}

export interface EnvelopeHeader {
	version: 1;
	params: { N: number; r: number; p: number };
	salt: Uint8Array;
	noncePrefix: Uint8Array;
	/** Header-Bytes (AAD) */
	raw: Uint8Array;
}

export interface ArchiveWriter {
	/** Einträge nacheinander; `data` wird vollständig gelesen, bevor der nächste beginnt */
	addEntry(name: string, data: ByteSource | Uint8Array, opts?: { level?: number }): Promise<void>;
	/** ZIP abschließen und Senke schließen */
	finish(): Promise<void>;
}

export interface ArchiveEntry {
	name: string;
	/** Inhalt; muss vollständig gelesen oder per `skip()` verworfen werden, bevor der nächste Eintrag kommt */
	stream(): ByteSource;
	skip(): Promise<void>;
}
