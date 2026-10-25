/**
 * Datensicherung – Import (Wiederherstellen bzw. Zusammenführen).
 *
 * 1. Upload in Stücken (`uploads.ts`).
 * 2. `analyzeBackup`: Recht + Re-Auth → Hülle entschlüsseln (Sicherungs-Passwort, Fehlversuche begrenzt) →
 *    kompletter Prüflauf über das ZIP (backup.json zuerst, checksums.json zuletzt, sha256/Bytes/Zeilen jedes
 *    Eintrags) → Kompatibilität, Kontoschutz, Zeilenzahlen → Vorschau-Token (15 min, Schlüssel im Speicher).
 * 3. `executeRestore`: Token + Bestätigungswort → Wartungssperre → asynchron (Status über `restoreStatus`):
 *    Dateien hochladen (zweiter Lauf, vor der Transaktion) → EINE Transaktion mit Löschen/Schema-Neuaufbau,
 *    Einfügen (dritter Lauf), restlichen Migrationen, Rehash (nur bei anderem Server-Schlüssel), Admin-Rechten,
 *    Modulstatus, Sitzungen → nach Commit verwaiste Objekte löschen → Audit.
 *
 * Klartext der Sicherung landet nie unverschlüsselt auf der Platte: jeder Lauf entschlüsselt die Datei neu.
 * Zeilen bleiben Rohtext (keine Genauigkeitsverluste); nur Zeilen mit Geheimnis-Marker oder solche, die ein
 * Filter braucht, werden geparst. Core-Services laufen nie innerhalb der offenen Transaktion (PGlite).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { sql, type SQL } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getAuth } from '../auth';
import { decryptSecret, keyedHash } from '../crypto';
import { getDb, type Tx } from '../database/client';
import { CoreError, errors, isCoreError } from '../errors';
import { pauseJobs, resumeJobs, runJobNow } from '../jobs';
import { systemContext } from '../auth/context';
import { allDefinitions, getDefinition } from '../modules/registry';
import {
	acceptedMigrationChecksums,
	coreMigrationIdentifiers,
	migrationChecksum,
	readCoreMigrationFiles
} from '../modules/migration-checksum';
import { isModuleEnabled, runModuleMigrations } from '../modules/service';
import { invalidateModuleStateCache } from '../modules/state';
import { moduleSchemaName } from '../modules/types';
import { ADMIN_ROLE_ID } from '../permissions/catalog';
import { isAdministrator } from '../permissions/service';
import { hit, peek, reset as resetRateLimit } from '../rate-limit';
import { deleteObjectUnchecked, objectExistsUnchecked, putObjectUnchecked } from '../storage';
import {
	acquireMaintenanceLock,
	releaseMaintenanceLock,
	verifyReauth
} from '../system/maintenance';
import { moduleDeleteOrder } from '../system/reset-areas';
import { ADMIN_ONLY_RESTORE_REASON, ADMIN_ONLY_RESTORE_SCOPES, requireBackupUser } from './access';
import {
	ACCOUNT_GUARD_TABLES,
	assessAccount,
	collectAccountRow,
	newAccountGuardData,
	type AccountAssessment
} from './account-guard';
import { readArchive } from './archive';
import { checkCompat, tableScopes } from './compat';
import { decryptEnvelope, deriveEnvelopeKey, readEnvelopeHeader } from './envelope';
import { insertRows, type InsertRow } from './insert';
import {
	IDENTIFIER,
	isNullableForeignKey,
	loadTableInfo,
	selfReference,
	sortRowsSelfRef
} from './introspect';
import { collect, hashingSource } from './io';
import { listBackupScopes, moduleInsertOrder, planTables, resolveScopes } from './scopes';
import { decodeRowSecrets, keyCheckValue } from './secrets';
import { dropUpload, holdUpload, uploadPath } from './uploads';
import {
	analyzeInput,
	BACKUP_LIMITS,
	BackupFormatError,
	backupMeta,
	checksums as checksumsSchema,
	dataEntryName,
	ENTRY_CHECKSUMS,
	ENTRY_DATA,
	ENTRY_FILE,
	ENTRY_META,
	executeInput,
	MERGE_CONFIRM_WORD,
	RESTORE_CONFIRM_WORD,
	type AnalyzeInput,
	type ArchiveEntry,
	type BackupMeta,
	type BackupScopeInfo,
	type ByteSource,
	type Checksums,
	type EnvelopeHeader,
	type ExecuteInput,
	type ForeignKeyInfo,
	type PreviewScope,
	type RestorePreview,
	type RestoreResult,
	type RunStatus,
	type TableInfo
} from './types';
import { rowsOf, type Row } from '../database/rows';

export { appendUpload, createUpload } from './uploads';

const BACKUP_PW_WINDOW_SEC = 10 * 60;
const BACKUP_PW_MAX_FAILURES = 10;
const MAX_JSON_ENTRY = 64 * 1024 * 1024;
const MAX_USER_REFS = 100_000;
/** Spalten in Modultabellen, die (vermutlich) Benutzer-IDs enthalten */
const USER_REF_COLUMN = /^(user_id|created_by|updated_by|owner_id|[a-z0-9_]+_user_id)$/;

const q = (name: string) => {
	if (!IDENTIFIER.test(name)) throw new Error(`Ungültiger Bezeichner: ${name}`);
	return `"${name}"`;
};
const corrupt = (msg = 'Die Sicherungsdatei ist beschädigt oder unvollständig.') =>
	new BackupFormatError('corrupt', msg);

// ---------------------------------------------------------------------------
// Uhr, Vorschau-Token, Läufe
// ---------------------------------------------------------------------------

let clock: () => number = () => Date.now();

/** Nur für Tests: verschobene Uhr (Ablauf der Vorschau-Token) */
export function setRestoreClockForTests(fn: (() => number) | undefined): void {
	clock = fn ?? (() => Date.now());
}

interface FileIndexEntry {
	moduleId: string;
	contentType: string;
}

interface PreviewEntry {
	userId: string;
	uploadId: string;
	header: EnvelopeHeader;
	key: Buffer;
	meta: BackupMeta;
	sums: Checksums;
	files: Map<string, FileIndexEntry>;
	available: Record<string, { available: boolean; reason?: string }>;
	account: AccountAssessment | null;
	secretChanged: boolean;
	scopeInfos: BackupScopeInfo[];
	expiresAt: number;
}

const previews = new Map<string, PreviewEntry>();
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

function discardPreview(k: string): void {
	const p = previews.get(k);
	if (!p) return;
	previews.delete(k);
	p.key.fill(0);
}

function sweepPreviews(): void {
	const now = clock();
	for (const [k, p] of previews) if (p.expiresAt <= now) discardPreview(k);
}

interface Run {
	userId: string;
	effectiveUserId: string;
	status: RunStatus;
	promise: Promise<void>;
}

const runs = new Map<string, Run>();

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

function openArchive(path: string, header: EnvelopeHeader, key: Buffer) {
	return readArchive(decryptEnvelope(path, header, key));
}

/** ndjson-Zeilen als Rohtext (leere Zeilen entfallen), Zeilenlänge begrenzt */
async function* ndjsonLines(source: ByteSource): AsyncGenerator<string> {
	const dec = new TextDecoder('utf-8', { fatal: true });
	let carry: Uint8Array[] = [];
	let carryLen = 0;
	const text = (b: Uint8Array) => {
		try {
			return dec.decode(b);
		} catch {
			throw corrupt();
		}
	};
	const tooLong = () =>
		new BackupFormatError('too_large', 'Eine Datenzeile der Sicherung ist zu groß.');
	for await (const chunk of source) {
		let off = 0;
		for (;;) {
			const i = chunk.indexOf(10, off);
			if (i < 0) break;
			const piece = chunk.subarray(off, i);
			off = i + 1;
			let line: Uint8Array = piece;
			if (carryLen > 0) {
				if (carryLen + piece.length > BACKUP_LIMITS.maxLineBytes) throw tooLong();
				carry.push(piece);
				line = Buffer.concat(carry, carryLen + piece.length);
				carry = [];
				carryLen = 0;
			}
			if (line.length > BACKUP_LIMITS.maxLineBytes) throw tooLong();
			if (line.length > 0) yield text(line);
		}
		if (off < chunk.length) {
			const rest = chunk.subarray(off);
			carryLen += rest.length;
			if (carryLen > BACKUP_LIMITS.maxLineBytes) throw tooLong();
			carry.push(Uint8Array.from(rest));
		}
	}
	if (carryLen > 0) yield text(Buffer.concat(carry, carryLen));
}

function parseLine(line: string): Row {
	let v: unknown;
	try {
		v = JSON.parse(line);
	} catch {
		throw corrupt();
	}
	if (!v || typeof v !== 'object' || Array.isArray(v)) throw corrupt();
	return v as Row;
}

async function readJsonEntry(entry: ArchiveEntry, onHash: (r: HashInfo) => void) {
	const bytes = await collect(hashingSource(entry.stream(), onHash), MAX_JSON_ENTRY);
	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	} catch {
		throw corrupt();
	}
}

interface HashInfo {
	sha256: string;
	bytes: number;
}

function expectHash(sums: Checksums, name: string, got: HashInfo, rows?: number): void {
	const c = sums.entries[name];
	if (!c || c.sha256 !== got.sha256 || c.bytes !== got.bytes) throw corrupt();
	if (rows !== undefined && c.rows !== undefined && c.rows !== rows) throw corrupt();
}

/** Geheimnis-Marker einer Rohzeile mit dem Zielschlüssel neu verschlüsseln (Rest bleibt Originaltext) */
async function decodeLine(t: TableInfo, line: string): Promise<string> {
	if (!line.includes('"$secret"')) return line;
	const row = parseLine(line);
	const out = await decodeRowSecrets(t, row);
	if (out === row) return line;
	let text = line;
	for (const col of t.columns) {
		const before = row[col.name];
		const after = out[col.name];
		if (before === after) continue;
		const key = JSON.stringify(col.name);
		const from = `${key}:${JSON.stringify(before)}`;
		const idx = text.indexOf(from);
		if (idx < 0) return JSON.stringify(out);
		text = `${text.slice(0, idx)}${key}:${JSON.stringify(after)}${text.slice(idx + from.length)}`;
	}
	return text;
}

function scopeOfFileModule(moduleId: string): string {
	return moduleId === 'core' ? 'core:users' : moduleId;
}

/** Bereich einer Zeile in zusammengelegten Tabellen (sonst `null` = alle Bereiche der Tabelle) */
function rowScope(table: string, row: Row): string | null {
	if (table === 'public.file') return scopeOfFileModule(String(row.module_id ?? ''));
	if (table === 'public.setting') return row.scope_id === '' ? 'core:settings' : 'core:users';
	return null;
}

// ---------------------------------------------------------------------------
// Fehlerabbildung
// ---------------------------------------------------------------------------

function formatError(e: BackupFormatError): CoreError {
	return errors.validation([
		{ path: [e.code === 'wrong_password' ? 'backupPassword' : 'file'], message: e.message }
	]);
}

function errorText(e: unknown): string {
	if (isCoreError(e) || e instanceof BackupFormatError) return e.message;
	return 'Unerwarteter Fehler';
}

// ---------------------------------------------------------------------------
// Analyse
// ---------------------------------------------------------------------------

async function targetCoreMigrations(): Promise<string[]> {
	const [has] = await rowsOf(
		getDb(),
		sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`
	);
	if (!(has?.ok === true || has?.ok === 't')) return [];
	const rows = await rowsOf(
		getDb(),
		sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations`
	);
	// Gespeicherte Hashes + Zeilenenden-Varianten der lokalen Dateien (Sicherung aus CRLF-/LF-Build)
	return coreMigrationIdentifiers(
		rows.map((r) => ({
			hash: String(r.hash),
			createdAt: r.created_at == null ? null : Number(r.created_at)
		})),
		readCoreMigrationFiles(resolve(process.cwd(), 'drizzle'))
	);
}

function whereSql(where: string | undefined): string {
	return where ? ` WHERE ${where}` : '';
}

export async function analyzeBackup(
	ctx: RequestContext,
	input: AnalyzeInput
): Promise<RestorePreview> {
	const userId = await requireBackupUser(ctx);
	const parsed = analyzeInput.safeParse(input);
	if (!parsed.success) throw errors.validation(parsed.error.issues);
	const data = parsed.data;
	await verifyReauth(userId, { password: data.password, totp: data.totp }, 'backup');
	const path = uploadPath(ctx, data.uploadId);

	const pwKey = `backupfilepw:${userId}`;
	if (peek(pwKey, BACKUP_PW_WINDOW_SEC) >= BACKUP_PW_MAX_FAILURES) {
		throw errors.badRequest('Zu viele Versuche. Bitte später erneut versuchen.');
	}

	holdUpload(data.uploadId, true);
	let key: Buffer | null = null;
	try {
		let header: EnvelopeHeader;
		try {
			header = await readEnvelopeHeader(path);
			key = await deriveEnvelopeKey(header, data.backupPassword);
		} catch (e) {
			if (e instanceof BackupFormatError) throw formatError(e);
			throw e;
		}
		await getAuth().$context;

		// --- Prüflauf ---------------------------------------------------------
		let meta: BackupMeta | null = null;
		let sums: Checksums | null = null;
		const seen = new Map<string, HashInfo & { rows?: number }>();
		const files = new Map<string, FileIndexEntry>();
		const fileEntries: string[] = [];
		const guard = newAccountGuardData();
		const rowsByScopeTable = new Map<string, number>();
		const backupUserIds = new Set<string>();
		const userRefs = new Set<string>();
		try {
			for await (const entry of openArchive(path, header, key)) {
				if (sums) throw corrupt();
				if (!meta) {
					if (entry.name !== ENTRY_META) throw corrupt();
					const raw = await readJsonEntry(entry, (r) => seen.set(ENTRY_META, r));
					const m = backupMeta.safeParse(raw);
					if (!m.success) {
						throw new BackupFormatError(
							'unsupported',
							'Die Sicherung hat ein unbekanntes Format oder stammt aus einer anderen Version.'
						);
					}
					meta = m.data;
					continue;
				}
				if (entry.name === ENTRY_CHECKSUMS) {
					const raw = await readJsonEntry(entry, () => {});
					const c = checksumsSchema.safeParse(raw);
					if (!c.success) throw corrupt();
					sums = c.data;
					continue;
				}
				const dm = ENTRY_DATA.exec(entry.name);
				if (dm) {
					const table = `${dm[1]}.${dm[2]}`;
					const tm = meta.tables.find((t) => t.name === table);
					if (!tm) throw corrupt();
					const scopes = tableScopes(tm);
					const isGuard = scopes.includes('core:users') && ACCOUNT_GUARD_TABLES.has(table);
					if (isGuard && table === 'public.role_permission') guard.rolePermissions ??= new Map();
					const split = table === 'public.file' || table === 'public.setting';
					const refCols = dm[1]!.startsWith('mod_')
						? tm.columns.map((c) => c.name).filter((c) => USER_REF_COLUMN.test(c))
						: [];
					let rows = 0;
					let info: HashInfo | null = null;
					for await (const line of ndjsonLines(hashingSource(entry.stream(), (r) => (info = r)))) {
						rows++;
						if (!isGuard && !split && !refCols.length && table !== 'public.user') continue;
						const row = parseLine(line);
						if (isGuard) collectAccountRow(guard, table, row);
						if (table === 'public.user' && typeof row.id === 'string') backupUserIds.add(row.id);
						if (table === 'public.file' && typeof row.object_key === 'string') {
							files.set(row.object_key, {
								moduleId: String(row.module_id ?? ''),
								contentType: String(row.content_type || 'application/octet-stream')
							});
						}
						for (const c of refCols) {
							const v = row[c];
							if (typeof v === 'string' && v && userRefs.size < MAX_USER_REFS) userRefs.add(v);
						}
						const rs = split ? rowScope(table, row) : null;
						if (rs) {
							const k = `${rs}|${table}`;
							rowsByScopeTable.set(k, (rowsByScopeTable.get(k) ?? 0) + 1);
						}
					}
					if (!split) for (const s of scopes) rowsByScopeTable.set(`${s}|${table}`, rows);
					seen.set(entry.name, { ...info!, rows });
					continue;
				}
				const fm = ENTRY_FILE.exec(entry.name);
				if (fm) {
					let info: HashInfo | null = null;
					for await (const chunk of hashingSource(entry.stream(), (r) => (info = r))) void chunk;
					seen.set(entry.name, info!);
					fileEntries.push(fm[1]!);
					continue;
				}
				throw corrupt();
			}
		} catch (e) {
			if (e instanceof BackupFormatError) {
				if (e.code === 'wrong_password') hit(pwKey, 1000, BACKUP_PW_WINDOW_SEC);
				throw formatError(e);
			}
			throw e;
		}
		resetRateLimit(pwKey);
		if (!meta || !sums) throw formatError(corrupt());
		for (const [name, s] of seen) {
			const c = sums.entries[name];
			if (!c && name === ENTRY_META) continue;
			if (!c || c.sha256 !== s.sha256 || c.bytes !== s.bytes) throw formatError(corrupt());
			if (s.rows !== undefined && c.rows !== undefined && c.rows !== s.rows) {
				throw formatError(corrupt());
			}
		}
		for (const name of Object.keys(sums.entries)) {
			if (!seen.has(name)) throw formatError(corrupt());
		}
		for (const k of fileEntries) {
			if (!files.has(k)) throw formatError(corrupt('Die Sicherung enthält eine unbekannte Datei.'));
		}

		// --- Kompatibilität ----------------------------------------------------
		const publicInfo = await loadTableInfo(getDb(), ['public']);
		const modulesTarget: Parameters<typeof checkCompat>[1]['modules'] = {};
		for (const id of Object.keys(meta.modules)) {
			const def = getDefinition(id);
			modulesTarget[id] = {
				registered: !!def,
				migrations: (def?.migrations ?? []).map((m) => ({
					name: m.name,
					checksum: migrationChecksum(m.sql),
					accepted: acceptedMigrationChecksums(m.sql)
				}))
			};
		}
		const compat = checkCompat(meta, {
			coreMigrations: await targetCoreMigrations(),
			modules: modulesTarget,
			tables: new Map(publicInfo.map((t) => [`${t.schema}.${t.table}`, t]))
		});
		const warnings = [...compat.warnings];

		// --- Kontoschutz -------------------------------------------------------
		let account: AccountAssessment | null = null;
		if (meta.scopes.includes('core:users')) {
			account = await assessAccount(userId, data.password, guard);
			if (account.blocked && compat.scopes['core:users']?.available) {
				compat.scopes['core:users'] = { available: false, reason: account.blocked };
			}
		}
		// Rechte-relevante Bereiche nur für Administrator*innen (#16)
		if (!isAdministrator(ctx)) {
			for (const s of ADMIN_ONLY_RESTORE_SCOPES) {
				if (compat.scopes[s]?.available) {
					compat.scopes[s] = { available: false, reason: ADMIN_ONLY_RESTORE_REASON };
				}
			}
		}

		// --- Vorschau ----------------------------------------------------------
		const allScopes = await listBackupScopes();
		const coreInfos = allScopes.filter((s) => s.group === 'core');
		const scopeInfos: BackupScopeInfo[] = [
			...coreInfos,
			...meta.scopes
				.filter((s) => !s.startsWith('core:'))
				.map((s) => ({
					key: s,
					group: 'module' as const,
					label: meta!.modules[s]?.name ?? getDefinition(s)?.manifest.name ?? s,
					description: '',
					implies: [],
					enabled: true
				}))
		];
		const fileStats = new Map<string, { count: number; bytes: number }>();
		for (const k of fileEntries) {
			const scope = scopeOfFileModule(files.get(k)!.moduleId);
			const st = fileStats.get(scope) ?? { count: 0, bytes: 0 };
			st.count++;
			st.bytes += sums.entries[`files/${k}`]?.bytes ?? 0;
			fileStats.set(scope, st);
		}
		const scopes: PreviewScope[] = [];
		for (const s of meta.scopes) {
			const avail = compat.scopes[s] ?? { available: false, reason: 'Unbekannter Bereich' };
			const info = scopeInfos.find((i) => i.key === s);
			const current = new Map<string, number>();
			if (avail.available) {
				try {
					const { tables } = await planTables(getDb(), [s]);
					for (const t of tables) {
						if (!IDENTIFIER.test(t.schema) || !IDENTIFIER.test(t.table)) continue;
						const [r] = await rowsOf(
							getDb(),
							sql.raw(
								`SELECT count(*)::int AS n FROM ${q(t.schema)}.${q(t.table)}${whereSql(t.where)}`
							)
						);
						const k = `${t.schema}.${t.table}`;
						current.set(k, (current.get(k) ?? 0) + Number(r?.n ?? 0));
					}
				} catch {
					// z. B. Modulschema fehlt – dann 0
				}
			}
			scopes.push({
				key: s,
				group: s.startsWith('core:') ? 'core' : 'module',
				label: info?.label ?? s,
				available: avail.available,
				...(avail.reason ? { reason: avail.reason } : {}),
				tables: meta.tables
					.filter((t) => tableScopes(t).includes(s))
					.map((t) => ({
						table: t.name,
						backupRows: rowsByScopeTable.get(`${s}|${t.name}`) ?? 0,
						currentRows: current.get(t.name) ?? 0
					})),
				files: fileStats.get(s) ?? { count: 0, bytes: 0 }
			});
		}

		let missingUserRefs = 0;
		if (userRefs.size) {
			const target = new Set(
				(await rowsOf(getDb(), sql`SELECT id FROM "public"."user"`)).map((r) => String(r.id))
			);
			for (const v of userRefs) if (!target.has(v) && !backupUserIds.has(v)) missingUserRefs++;
		}

		const secretChanged = meta.keyCheck !== keyCheckValue();
		if (secretChanged) {
			warnings.push(
				'Die Sicherung stammt von einem Server mit anderem Schlüssel: Geheimnisse werden neu verschlüsselt, schlüsselgebundene Prüfwerte neu berechnet.'
			);
		}
		if (fileEntries.length) {
			try {
				await objectExistsUnchecked('core/backup-probe');
			} catch {
				warnings.push(
					'Kein Dateispeicher konfiguriert: Dateien aus der Sicherung werden beim Wiederherstellen übersprungen.'
				);
			}
		}
		if (meta.includesFiles && fileEntries.length < meta.files.count) {
			warnings.push(
				`${meta.files.count - fileEntries.length} Dateien fehlten schon beim Erstellen der Sicherung.`
			);
		}

		sweepPreviews();
		const token = randomBytes(24).toString('base64url');
		const expiresAt = clock() + BACKUP_LIMITS.tokenTtlMs;
		previews.set(hashToken(token), {
			userId,
			uploadId: data.uploadId,
			header,
			key,
			meta,
			sums,
			files,
			available: compat.scopes,
			account,
			secretChanged,
			scopeInfos,
			expiresAt
		});
		key = null;
		return {
			token,
			expiresAt: new Date(expiresAt).toISOString(),
			backup: {
				createdAt: meta.createdAt,
				createdBy: meta.createdBy.name,
				appVersion: meta.appVersion,
				sourceOrigin: meta.sourceOrigin,
				includesFiles: meta.includesFiles
			},
			secretChanged,
			scopes,
			account: account
				? {
						case: account.case,
						willLogout: account.willLogout,
						twoFactorInBackup: account.twoFactorInBackup
					}
				: { case: 'kept', willLogout: false, twoFactorInBackup: false },
			missingUserRefs,
			warnings
		};
	} finally {
		key?.fill(0);
		holdUpload(data.uploadId, false);
	}
}

// ---------------------------------------------------------------------------
// Ausführen
// ---------------------------------------------------------------------------

export async function executeRestore(
	ctx: RequestContext,
	input: ExecuteInput
): Promise<{ runId: string }> {
	const userId = await requireBackupUser(ctx);
	const parsed = executeInput.safeParse(input);
	if (!parsed.success) throw errors.validation(parsed.error.issues);
	const data = parsed.data;
	sweepPreviews();
	const tokenKey = hashToken(data.token);
	const preview = previews.get(tokenKey);
	if (!preview || preview.userId !== userId) {
		throw errors.conflict('Vorschau abgelaufen, bitte neu starten');
	}
	const word = data.mode === 'restore' ? RESTORE_CONFIRM_WORD : MERGE_CONFIRM_WORD;
	if (data.confirmWord !== word) {
		throw errors.validation([{ path: ['confirmWord'], message: `Bitte genau "${word}" eingeben` }]);
	}
	const resolved = resolveScopes(data.scopes, preview.scopeInfos);
	const inBackup = new Set(preview.meta.scopes);
	const unknown = [...resolved.unknown, ...data.scopes.filter((s) => !inBackup.has(s))];
	if (unknown.length) {
		throw errors.validation([
			{ path: ['scopes'], message: `Nicht in der Sicherung: ${[...new Set(unknown)].join(', ')}` }
		]);
	}
	const chosen = resolved.scopes.filter((s) => inBackup.has(s));
	const blocked = chosen.filter((s) => !preview.available[s]?.available);
	if (blocked.length) {
		const reason = preview.available[blocked[0]!]?.reason;
		throw errors.validation([
			{
				path: ['scopes'],
				message: `Nicht wiederherstellbar: ${blocked.join(', ')}${reason ? ` (${reason})` : ''}`
			}
		]);
	}
	// Datei noch vorhanden?
	const path = uploadPath(ctx, preview.uploadId);

	acquireMaintenanceLock('Wiederherstellung');
	previews.delete(tokenKey);
	holdUpload(preview.uploadId, true);

	const runId = randomUUID();
	const account = data.mode === 'restore' && chosen.includes('core:users') ? preview.account : null;
	const status: RunStatus = {
		runId,
		state: 'running',
		phase: 'Vorbereiten',
		progress: { done: 0, total: 1 }
	};
	const run: Run = {
		userId,
		effectiveUserId: account?.effectiveUserId ?? userId,
		status,
		promise: Promise.resolve()
	};
	runs.set(runId, run);
	run.promise = (async () => {
		const result: RestoreResult = {
			mode: data.mode,
			scopes: chosen,
			inserted: 0,
			deleted: 0,
			skipped: {},
			files: { uploaded: 0, skipped: 0, failed: 0 },
			rehash: { updated: 0, unrecoverable: 0 },
			loggedOut: !!account?.willLogout,
			warnings: []
		};
		let failure: unknown = null;
		pauseJobs();
		try {
			await runRestore({ ctx, userId, data, preview, path, chosen, account, status, result });
			dropUpload(preview.uploadId);
		} catch (e) {
			failure = e;
			if (!isCoreError(e) && !(e instanceof BackupFormatError)) {
				console.error('Wiederherstellung fehlgeschlagen', e);
			}
			status.state = 'failed';
			status.error = `Die Wiederherstellung ist fehlgeschlagen, es wurden keine Daten geändert: ${errorText(e)}`;
			holdUpload(preview.uploadId, false);
		} finally {
			preview.key.fill(0);
			resumeJobs();
			releaseMaintenanceLock();
		}
		if (!failure) {
			status.phase = 'Abgleich';
			await runPostRestoreJobs(chosen, result);
			status.state = 'done';
			status.phase = 'Fertig';
			status.result = result;
		}
		try {
			await auditFromContext(ctx, 'core.system.backup_restored', {
				metadata: {
					mode: data.mode,
					scopes: chosen,
					inserted: result.inserted,
					deleted: result.deleted,
					files: result.files.uploaded,
					secretChanged: preview.secretChanged,
					sourceCreatedAt: preview.meta.createdAt,
					...(failure ? { failed: true } : {})
				}
			});
		} catch (e) {
			console.error('Audit der Wiederherstellung fehlgeschlagen', e);
		}
	})();
	return { runId };
}

/**
 * Jobs, die nach dem Wiederherstellen eines Moduls abgeleitete Core-Daten neu bilden. Bisher nur einer:
 * `offices.sync-grants` (Rollen aus Ämtern → `user_role_grant`; das Modul-Rebuild löscht die Verleihungen des
 * Moduls). Weitere Module mit solchen Abgleich-Jobs hier ergänzen.
 */
const POST_RESTORE_JOBS: { module: string; job: string }[] = [
	{ module: 'offices', job: 'offices.sync-grants' }
];

/** Nach Commit und `resumeJobs`, best-effort (Fehler → Warnung). Nur für wiederhergestellte, aktive Module. */
async function runPostRestoreJobs(chosen: string[], result: RestoreResult): Promise<void> {
	for (const j of POST_RESTORE_JOBS) {
		if (!chosen.includes(j.module) || !(await isModuleEnabled(j.module))) continue;
		try {
			// Abgleich nach der Wiederherstellung ist Systemarbeit – nicht an core.jobs.manage der Person binden
			await runJobNow(systemContext('backup-restore'), j.job);
		} catch (e) {
			result.warnings.push(
				`Abgleich ${j.job} konnte nicht ausgeführt werden (${errorText(e)}); er läuft beim nächsten Takt.`
			);
		}
	}
}

export async function restoreStatus(ctx: RequestContext, runId: string): Promise<RunStatus> {
	const run = typeof runId === 'string' ? runs.get(runId) : undefined;
	if (!run || (run.userId !== ctx.userId && run.effectiveUserId !== ctx.userId)) {
		throw errors.notFound('Lauf nicht gefunden');
	}
	await requireBackupUser(ctx);
	return structuredClone(run.status);
}

/** Nur für Tests: auf das Ende eines Laufs warten */
export async function waitForRestore(runId: string): Promise<RunStatus> {
	const run = runs.get(runId);
	if (!run) throw errors.notFound('Lauf nicht gefunden');
	await run.promise;
	return structuredClone(run.status);
}

// ---------------------------------------------------------------------------
// Ablauf
// ---------------------------------------------------------------------------

interface RunArgs {
	ctx: RequestContext;
	userId: string;
	data: ExecuteInput;
	preview: PreviewEntry;
	path: string;
	chosen: string[];
	account: AccountAssessment | null;
	status: RunStatus;
	result: RestoreResult;
}

interface TablePlan {
	info: TableInfo;
	/** OR der Bereichsfilter oder `null` = ganze Tabelle */
	where: string | null;
}

function groupPlan(
	planned: { schema: string; table: string; where?: string }[],
	info: TableInfo[]
): Map<string, TablePlan> {
	const byKey = new Map(info.map((t) => [`${t.schema}.${t.table}`, t]));
	const wheres = new Map<string, (string | undefined)[]>();
	for (const p of planned) {
		const k = `${p.schema}.${p.table}`;
		if (!byKey.has(k)) continue;
		const list = wheres.get(k) ?? [];
		list.push(p.where);
		wheres.set(k, list);
	}
	const out = new Map<string, TablePlan>();
	for (const [k, list] of wheres) {
		out.set(k, {
			info: byKey.get(k)!,
			where: list.some((w) => !w) ? null : list.map((w) => `(${w})`).join(' OR ')
		});
	}
	return out;
}

/** Spalte, über die eine Core-Tabelle dem Benutzer gehört (Fall `kept`: eigene Zeilen behalten) */
const OWN_COLUMN: Record<string, string> = {
	'public.user': 'id',
	'public.account': 'user_id',
	'public.two_factor': 'user_id',
	'public.session': 'user_id',
	'public.user_role': 'user_id',
	'public.user_role_grant': 'user_id',
	'public.user_permission': 'user_id',
	'public.notification_pref': 'user_id',
	'public.setting': 'scope_id',
	'public.api_key': 'owner_id'
};

function settingsFilter(takeSmtp: boolean): string {
	return `x."key" NOT LIKE 'core.storage.%'${takeSmtp ? '' : ` AND x."key" NOT LIKE 'core.smtp.%'`}`;
}

interface PendingDeferred {
	table: TableInfo;
	name: string;
	fks: ForeignKeyInfo[];
	/** PK (Text) → PK + verzögerte Spalten */
	values: Map<string, Row>;
	/** PKs der in diesem Lauf eingefügten Zeilen */
	inserted: Set<string>;
}

/**
 * FKs von `t` auf Tabellen, die im Archiv erst später eingefügt werden (Zyklus, beim Export gebrochen).
 * Müssen nullbar sein; die Tabelle braucht einen einspaltigen Primärschlüssel.
 */
function deferredForeignKeys(
	t: TableInfo,
	name: string,
	archiveIndex: Map<string, number>
): ForeignKeyInfo[] {
	const own = archiveIndex.get(name);
	if (own === undefined) return [];
	const out = t.foreignKeys.filter((fk) => {
		const ref = `${fk.refSchema}.${fk.refTable}`;
		if (ref === name) return false;
		const i = archiveIndex.get(ref);
		return i !== undefined && i > own;
	});
	if (!out.length) return out;
	if (out.some((fk) => !isNullableForeignKey(t, fk)) || t.primaryKey.length !== 1) {
		throw errors.badRequest(
			`Tabelle ${name} hat zyklische Fremdschlüssel, die sich nicht auflösen lassen`
		);
	}
	return out;
}

/** Verzögerte Spalten per UPDATE setzen; liefert die Zahl nicht setzbarer Verweise. */
async function applyDeferred(tx: Tx, p: PendingDeferred): Promise<number> {
	const t = p.table;
	const pk = t.primaryKey[0]!;
	const rows = [...p.values.entries()].filter(([k]) => p.inserted.has(k)).map(([, v]) => v);
	let missing = 0;
	const table = `${q(t.schema)}.${q(t.table)}`;
	for (const fk of p.fks) {
		const relevant = rows.filter((r) =>
			fk.columns.every((c) => r[c] !== null && r[c] !== undefined)
		);
		for (let i = 0; i < relevant.length; i += BACKUP_LIMITS.rowBatch) {
			const batch = relevant.slice(i, i + BACKUP_LIMITS.rowBatch);
			const set = fk.columns.map((c) => `${q(c)} = x.${q(c)}`).join(', ');
			const match = fk.columns.map((c, j) => `r.${q(fk.refColumns[j]!)} = x.${q(c)}`).join(' AND ');
			const head = `WITH u AS (UPDATE ${table} AS t SET ${set} FROM json_populate_recordset(NULL::${table}, `;
			const tail = `::json) x WHERE t.${q(pk)} = x.${q(pk)} AND EXISTS (SELECT 1 FROM ${q(fk.refSchema)}.${q(fk.refTable)} r WHERE ${match}) RETURNING 1) SELECT count(*)::int AS n FROM u`;
			const [r] = await rowsOf(tx, sql`${sql.raw(head)}${JSON.stringify(batch)}${sql.raw(tail)}`);
			missing += batch.length - Number(r?.n ?? 0);
		}
	}
	return missing;
}

async function runRestore(a: RunArgs): Promise<void> {
	const { data, preview, path, chosen, account, status, result, userId } = a;
	const restore = data.mode === 'restore';
	const chosenSet = new Set(chosen);
	const moduleIds = chosen.filter((s) => !s.startsWith('core:'));
	const hasUsers = chosenSet.has('core:users');
	const keepOwn = restore && hasUsers && account?.case === 'kept';
	const sameId = restore && hasUsers && account?.case === 'same' && !account.willLogout;
	const effectiveUserId = account?.effectiveUserId ?? userId;

	const fileKeys = [...preview.files.entries()]
		.filter(
			([k, f]) => chosenSet.has(scopeOfFileModule(f.moduleId)) && preview.sums.entries[`files/${k}`]
		)
		.map(([k]) => k);
	const dataTables = preview.meta.tables.filter((t) =>
		tableScopes(t).some((s) => chosenSet.has(s))
	);
	status.progress = { done: 0, total: fileKeys.length + dataTables.length + 1 };

	// Bisherige (manuelle) Rollen der ausführenden Person: Ein Restore verleiht nie mehr Rechte als vorher –
	// statt pauschal die Administrator-Rolle werden nur diese wieder zugeordnet (#16)
	const ownRoleIds = (
		await rowsOf(getDb(), sql`SELECT role_id FROM "public"."user_role" WHERE user_id = ${userId}`)
	).map((r) => String(r.role_id));

	// Alte Objekte (nur Wiederherstellen) vor der Transaktion merken
	let oldObjectKeys: string[] = [];
	if (restore) {
		const { tables } = await planTables(getDb(), chosen);
		const wheres = tables.filter((t) => t.schema === 'public' && t.table === 'file');
		if (wheres.length) {
			const w = wheres.some((t) => !t.where)
				? ''
				: ` WHERE ${wheres.map((t) => `(${t.where})`).join(' OR ')}`;
			oldObjectKeys = (
				await rowsOf(getDb(), sql.raw(`SELECT object_key FROM "public"."file"${w}`))
			).map((r) => String(r.object_key));
		}
	}

	// 1) Dateien -------------------------------------------------------------
	const uploaded: string[] = [];
	try {
		if (fileKeys.length) {
			status.phase = 'Dateien prüfen';
			let storageOk = true;
			try {
				await objectExistsUnchecked(fileKeys[0]!);
			} catch (e) {
				if (!(isCoreError(e) && e.code === 'unavailable')) throw e;
				storageOk = false;
				result.files.skipped = fileKeys.length;
				result.warnings.push(
					'Kein Dateispeicher konfiguriert: Dateien wurden übersprungen, die Datensätze sind trotzdem wiederhergestellt.'
				);
				status.progress.done += fileKeys.length;
			}
			if (storageOk) {
				status.phase = 'Dateien hochladen';
				const wanted = new Set(fileKeys);
				for await (const entry of openArchive(path, preview.header, preview.key)) {
					const fm = ENTRY_FILE.exec(entry.name);
					if (!fm || !wanted.has(fm[1]!)) continue;
					const objectKey = fm[1]!;
					status.progress.done++;
					if (await objectExistsUnchecked(objectKey)) {
						result.files.skipped++;
						continue;
					}
					let info: HashInfo | null = null;
					const bytes = await collect(
						hashingSource(entry.stream(), (r) => (info = r)),
						BACKUP_LIMITS.maxEntryBytes
					);
					expectHash(preview.sums, entry.name, info!);
					try {
						await putObjectUnchecked(objectKey, bytes, preview.files.get(objectKey)!.contentType);
						uploaded.push(objectKey);
						result.files.uploaded++;
					} catch (e) {
						if (isCoreError(e) && e.code === 'unavailable') throw e;
						result.files.failed++;
						result.warnings.push(`Datei ${objectKey} konnte nicht hochgeladen werden`);
					}
				}
			}
		}

		// 2) Daten (eine Transaktion) ------------------------------------------
		await getAuth().$context;
		const metaTables = new Map(preview.meta.tables.map((t) => [t.name, t]));
		await getDb().transaction(async (tx) => {
			status.phase = 'Daten löschen';
			const defaultPath = sql.raw('SET LOCAL search_path TO DEFAULT');
			const backupMigrations = (id: string) =>
				new Set((preview.meta.modules[id]?.migrations ?? []).map((m) => m.name));
			const deps = (id: string) => {
				const d = getDefinition(id);
				return d ? [...d.manifest.dependencies, ...(d.manifest.optionalDependencies ?? [])] : [];
			};

			// Module vorbereiten
			if (restore) {
				for (const id of moduleDeleteOrder(moduleIds.map((m) => ({ id: m, deps: deps(m) })))) {
					const schemaName = moduleSchemaName(id);
					for (const t of await loadTableInfo(tx, [schemaName])) {
						const [r] = await rowsOf(
							tx,
							sql.raw(`SELECT count(*)::int AS n FROM ${q(t.schema)}.${q(t.table)}`)
						);
						result.deleted += Number(r?.n ?? 0);
					}
					await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS ${q(schemaName)} CASCADE`));
					await tx.execute(sql`DELETE FROM "public"."module_migration" WHERE module_id = ${id}`);
					await tx.execute(sql`DELETE FROM "public"."user_role_grant" WHERE module_id = ${id}`);
				}
			}
			for (const id of moduleInsertOrder(moduleIds.map((m) => ({ id: m, deps: deps(m) })))) {
				await runModuleMigrations(id, tx, { only: backupMigrations(id) });
				await tx.execute(defaultPath);
				if (restore) {
					// Startdaten der Migrationen entfernen
					// (ein TRUNCATE über alle Tabellen – unabhängig von FK-Reihenfolge und Zyklen)
					const info = await loadTableInfo(tx, [moduleSchemaName(id)]);
					if (info.length) {
						await tx.execute(
							sql.raw(`TRUNCATE ${info.map((t) => `${q(t.schema)}.${q(t.table)}`).join(', ')}`)
						);
					}
				}
			}

			const { tables: planned, info } = await planTables(tx, chosen);
			const plan = groupPlan(planned, info);
			const publicInfo = new Map(
				(await loadTableInfo(tx, ['public'])).map((t) => [`${t.schema}.${t.table}`, t])
			);

			// Eigene Sitzungen merken (gleiches Konto, gleiche ID)
			let ownSessions: string[] = [];
			if (sameId) {
				ownSessions = (
					await rowsOf(
						tx,
						sql`SELECT row_to_json(s)::text AS j FROM "public"."session" s WHERE s.user_id = ${userId}`
					)
				).map((r) => String(r.j));
			}

			// Core löschen (umgekehrte Reihenfolge)
			if (restore) {
				if (chosenSet.has('core:audit')) {
					await tx.execute(sql.raw(`SET LOCAL app.audit_reset = 'on'`));
				}
				for (const p of [...planned].reverse()) {
					if (p.schema !== 'public') continue;
					const k = `public.${p.table}`;
					const conds: SQL[] = [];
					if (p.where) conds.push(sql.raw(`(${p.where})`));
					if (p.table === 'setting') {
						conds.push(sql.raw(`key NOT LIKE 'core.storage.%'`));
						if (!data.takeSmtp) conds.push(sql.raw(`key NOT LIKE 'core.smtp.%'`));
					}
					if (keepOwn && OWN_COLUMN[k]) {
						conds.push(sql`${sql.raw(q(OWN_COLUMN[k]))} <> ${userId}`);
					}
					if (keepOwn && p.table === 'file') {
						conds.push(sql`NOT (module_id = 'core' AND path = ${`avatars/${userId}`})`);
					}
					const w = conds.length ? sql` WHERE ${sql.join(conds, sql` AND `)}` : sql``;
					const [r] = await rowsOf(
						tx,
						sql`WITH d AS (DELETE FROM ${sql.raw(`"public".${q(p.table)}`)}${w} RETURNING 1) SELECT count(*)::int AS n FROM d`
					);
					result.deleted += Number(r?.n ?? 0);
				}
			}

			// Einfügen
			status.phase = 'Daten einfügen';
			const newUserIds = new Set<string>();
			const wantedEntries = new Set(
				dataTables.map((t) => {
					const [schemaName, table] = t.name.split('.') as [string, string];
					return dataEntryName(schemaName, table);
				})
			);
			// FK-Kanten zu Tabellen, die erst später im Archiv kommen (gebrochene Zyklen): beim Einfügen NULL,
			// danach per UPDATE setzen
			const archiveIndex = new Map(dataTables.map((t, i) => [t.name, i]));
			const pendingDeferred: PendingDeferred[] = [];
			for await (const entry of openArchive(path, preview.header, preview.key)) {
				const dm = ENTRY_DATA.exec(entry.name);
				if (!dm) continue;
				const name = `${dm[1]}.${dm[2]}`;
				if (!wantedEntries.has(entry.name)) continue;
				status.progress.done++;
				const tp = plan.get(name);
				const tm = metaTables.get(name)!;
				if (!tp) {
					result.warnings.push(`Tabelle ${name} fehlt auf diesem Server und wurde übersprungen`);
					continue;
				}
				const t = tp.info;
				const targetCols = new Set(t.columns.map((c) => c.name));
				const dropped = tm.columns.map((c) => c.name).filter((c) => !targetCols.has(c));
				if (dropped.length) {
					result.warnings.push(`${name}: Spalten ${dropped.join(', ')} wurden nicht übernommen`);
				}
				const conds: string[] = [];
				if (tp.where) conds.push(tp.where);
				if (name === 'public.setting') conds.push(settingsFilter(data.takeSmtp));
				if (!restore && name === 'public.user') {
					conds.push(
						`NOT EXISTS (SELECT 1 FROM "public"."user" u WHERE u.id = x.id OR lower(u.email) = lower(x.email))`
					);
				}
				const onlyNewUsers =
					!restore && (name === 'public.account' || name === 'public.two_factor');
				const deferred = deferredForeignKeys(t, name, archiveIndex);
				const pending: PendingDeferred | null = deferred.length
					? { table: t, name, fks: deferred, values: new Map(), inserted: new Set() }
					: null;
				if (pending) pendingDeferred.push(pending);
				const deferredCols = new Set(deferred.flatMap((fk) => fk.columns));
				const isMergeUser = !restore && name === 'public.user';
				const opts = {
					where: conds.length ? conds.map((c) => `(${c})`).join(' AND ') : undefined,
					sourceColumns: tm.columns.map((c) => c.name).filter((c) => !deferredCols.has(c)),
					returnColumn: pending ? t.primaryKey[0]! : isMergeUser ? 'id' : undefined
				};
				const remember = (line: string) => {
					if (!pending) return;
					const row = parseLine(line);
					const pk = t.primaryKey[0]!;
					if (row[pk] === null || row[pk] === undefined) return;
					if (![...deferredCols].some((c) => row[c] !== null && row[c] !== undefined)) return;
					const v: Row = { [pk]: row[pk] };
					for (const c of deferredCols) v[c] = row[c] ?? null;
					pending.values.set(String(row[pk]), v);
				};
				let skipped = 0;
				const flush = async (batch: InsertRow[]) => {
					if (!batch.length) return;
					const r = await insertRows(tx, t, batch, opts);
					result.inserted += r.inserted;
					skipped += r.skipped;
					if (pending) for (const id of r.returned) pending.inserted.add(id);
					if (isMergeUser) for (const id of r.returned) newUserIds.add(id);
				};
				let info: HashInfo | null = null;
				let rows = 0;
				const lines = ndjsonLines(hashingSource(entry.stream(), (r) => (info = r)));
				if (selfReference(t)) {
					const byRow = new Map<Row, string>();
					for await (const line of lines) {
						rows++;
						if (byRow.size >= BACKUP_LIMITS.maxSelfRefRows) {
							throw errors.badRequest(`Tabelle ${name} ist zu groß für die Wiederherstellung`);
						}
						byRow.set(parseLine(line), line);
					}
					let batch: InsertRow[] = [];
					for (const row of sortRowsSelfRef([...byRow.keys()], t)) {
						remember(byRow.get(row)!);
						batch.push(await decodeLine(t, byRow.get(row)!));
						if (batch.length >= BACKUP_LIMITS.rowBatch) {
							await flush(batch);
							batch = [];
						}
					}
					await flush(batch);
				} else {
					let batch: InsertRow[] = [];
					for await (const line of lines) {
						rows++;
						if (onlyNewUsers) {
							const uid = parseLine(line).user_id;
							if (typeof uid !== 'string' || !newUserIds.has(uid)) {
								skipped++;
								continue;
							}
						}
						remember(line);
						batch.push(await decodeLine(t, line));
						if (batch.length >= BACKUP_LIMITS.rowBatch) {
							await flush(batch);
							batch = [];
						}
					}
					await flush(batch);
				}
				expectHash(preview.sums, entry.name, info!, rows);
				if (skipped) result.skipped[name] = (result.skipped[name] ?? 0) + skipped;
			}

			// Verzögerte FK-Spalten setzen (nur eingefügte Zeilen, nur wenn die Elternzeile existiert)
			for (const p of pendingDeferred) {
				const missing = await applyDeferred(tx, p);
				if (missing) {
					result.warnings.push(
						`${p.name}: ${missing} Verweise ließen sich nicht wiederherstellen (Ziel fehlt)`
					);
				}
			}

			status.phase = 'Abschluss';
			// Neuere Modul-Migrationen
			for (const id of moduleInsertOrder(moduleIds.map((m) => ({ id: m, deps: deps(m) })))) {
				await runModuleMigrations(id, tx);
				await tx.execute(defaultPath);
			}

			// Rehash nur bei anderem Server-Schlüssel
			if (preview.secretChanged) {
				for (const id of moduleIds) {
					const hook = getDefinition(id)?.backup?.rehash;
					if (!hook) continue;
					const purpose = `module:${id}`;
					// nur das Modulschema: Hooks dürfen keine Core-Tabellen treffen (#73, 07-07)
					await tx.execute(sql.raw(`SET LOCAL search_path TO ${q(moduleSchemaName(id))}`));
					const r = await hook(tx as Tx, {
						hash: (v) => keyedHash(v, purpose),
						decrypt: (v) => decryptSecret(v, purpose)
					});
					await tx.execute(defaultPath);
					result.rehash.updated += r.updated;
					result.rehash.unrecoverable += r.unrecoverable;
				}
				if (result.rehash.unrecoverable) {
					result.warnings.push(
						`${result.rehash.unrecoverable} Prüfwerte ließen sich mit dem neuen Schlüssel nicht wiederherstellen (z. B. alte Freigabelinks wurden widerrufen)`
					);
				}
			}

			// Administrator-Rolle hat immer alle Rechte
			await tx.execute(
				sql`INSERT INTO "public"."role" (id, name, description, is_system)
					VALUES (${ADMIN_ROLE_ID}, 'Administrator', 'Vollzugriff auf alle Funktionen', true)
					ON CONFLICT DO NOTHING`
			);
			await tx.execute(
				sql`INSERT INTO "public"."role_permission" (role_id, permission_key)
					SELECT ${ADMIN_ROLE_ID}, key FROM "public"."permission" ON CONFLICT DO NOTHING`
			);

			// Eigenes Konto: nie mehr Rechte als vorher (#16). Fehlt nach dem Wiederherstellen das Recht zur
			// Datensicherung (oder bleibt das Konto im Fall `kept` erhalten), werden nur die BISHERIGEN Rollen
			// der Person wieder zugeordnet (soweit es sie noch gibt) – nicht pauschal die Administrator-Rolle.
			const [exists] = await rowsOf(
				tx,
				sql`SELECT EXISTS (SELECT 1 FROM "public"."user" WHERE id = ${effectiveUserId}) AS ok`
			);
			if (exists?.ok === true || exists?.ok === 't') {
				const hasBackupRight = async () => {
					const [has] = await rowsOf(
						tx,
						sql`SELECT (EXISTS (
							SELECT 1 FROM "public"."user_role" ur
							LEFT JOIN "public"."role_permission" rp ON rp.role_id = ur.role_id
							WHERE ur.user_id = ${effectiveUserId}
								AND (ur.role_id = ${ADMIN_ROLE_ID} OR rp.permission_key = 'core.system.backup')
						) OR EXISTS (
							SELECT 1 FROM "public"."user_permission" up
							WHERE up.user_id = ${effectiveUserId} AND up.permission_key = 'core.system.backup'
						)) AS ok`
					);
					return has?.ok === true || has?.ok === 't';
				};
				if ((keepOwn || !(await hasBackupRight())) && effectiveUserId === userId) {
					for (const roleId of ownRoleIds) {
						await tx.execute(
							sql`INSERT INTO "public"."user_role" (user_id, role_id)
								SELECT ${userId}, id FROM "public"."role" WHERE id = ${roleId}
								ON CONFLICT DO NOTHING`
						);
					}
				}
				if (!(await hasBackupRight())) {
					result.warnings.push(
						'Dem eigenen Konto fehlt nach dem Wiederherstellen das Recht zur Datensicherung. Es wurden keine zusätzlichen Rechte vergeben – bitte eine*n Administrator*in um die passende Rolle bitten.'
					);
				}
			}

			// Modulstatus aus der Sicherung
			if (restore && data.applyModuleState && moduleIds.length) {
				const state = new Map(
					(await rowsOf(tx, sql`SELECT id, enabled FROM "public"."module_state"`)).map((r) => [
						String(r.id),
						r.enabled === true || r.enabled === 't'
					])
				);
				// Nur harte Abhängigkeiten: optionale können Zyklen bilden (actions ↔ treasury), die
				// Aktivierung prüft ohnehin nur `dependencies`
				const order = moduleInsertOrder(
					moduleIds.map((m) => ({ id: m, deps: getDefinition(m)?.manifest.dependencies ?? [] }))
				);
				const setState = async (id: string, enabled: boolean) => {
					await tx.execute(
						sql`UPDATE "public"."module_state" SET enabled = ${enabled}, updated_at = now() WHERE id = ${id}`
					);
					state.set(id, enabled);
				};
				for (const id of order) {
					const want = preview.meta.modules[id]?.enabled;
					if (!want || state.get(id)) continue;
					const missing = (getDefinition(id)?.manifest.dependencies ?? []).filter(
						(d) => !state.get(d)
					);
					if (missing.length) {
						result.warnings.push(
							`Modul ${id} bleibt inaktiv: Abhängigkeiten nicht aktiv (${missing.join(', ')})`
						);
						continue;
					}
					await setState(id, true);
				}
				for (const id of [...order].reverse()) {
					const want = preview.meta.modules[id]?.enabled;
					if (want === undefined || want || !state.get(id)) continue;
					const dependents = allDefinitions()
						.filter((d) => d.manifest.dependencies.includes(id) && state.get(d.manifest.id))
						.map((d) => d.manifest.id);
					if (dependents.length) {
						result.warnings.push(
							`Modul ${id} bleibt aktiv: wird von aktiven Modulen benötigt (${dependents.join(', ')})`
						);
						continue;
					}
					await setState(id, false);
				}
			}

			// Sitzungen und Bestätigungslinks
			if (restore && hasUsers) {
				const sessionInfo = publicInfo.get('public.session');
				if (sameId && ownSessions.length && sessionInfo) {
					await insertRows(tx, sessionInfo, ownSessions);
				}
				if (keepOwn || sameId) {
					await tx.execute(sql`DELETE FROM "public"."session" WHERE user_id <> ${userId}`);
				} else {
					await tx.execute(sql`DELETE FROM "public"."session"`);
				}
			}
			if (hasUsers) await tx.execute(sql`DELETE FROM "public"."verification"`);
			status.progress.done++;
		});
	} catch (e) {
		for (const k of uploaded) await deleteObjectUnchecked(k);
		throw e;
	}

	// 3) Nach dem Commit -----------------------------------------------------
	invalidateModuleStateCache();
	let storageOk = oldObjectKeys.length > 0;
	if (storageOk) {
		try {
			await objectExistsUnchecked(oldObjectKeys[0]!);
		} catch {
			storageOk = false;
		}
	}
	if (restore && storageOk) {
		const still = new Set<string>();
		for (let i = 0; i < oldObjectKeys.length; i += 500) {
			const part = oldObjectKeys.slice(i, i + 500);
			const rows = await rowsOf(
				getDb(),
				sql`SELECT object_key FROM "public"."file" WHERE object_key IN (${sql.join(
					part.map((k) => sql`${k}`),
					sql`, `
				)})`
			);
			for (const r of rows) still.add(String(r.object_key));
		}
		let failed = 0;
		for (const k of oldObjectKeys) {
			if (still.has(k)) continue;
			if (!(await deleteObjectUnchecked(k).catch(() => false))) failed++;
		}
		if (failed) {
			result.warnings.push(`${failed} alte Dateien konnten nicht aus dem Speicher gelöscht werden`);
		}
	}
}
