/**
 * Datensicherung – Export.
 *
 * Ablauf: Recht/Session → Eingabe prüfen → Passwort (+ TOTP) → Bereiche auflösen → Wartungssperre →
 * Temp-Datei ← Hülle (Sicherungs-Passwort) ← ZIP. Der Datenbankteil läuft in EINER Transaktion
 * (`REPEATABLE READ READ ONLY`): erst werden alle Zeilen gezählt (gleicher Snapshot → exakte Zahlen
 * für `backup.json`, das als erster Eintrag geschrieben wird), danach je Tabelle ein ndjson-Eintrag
 * über einen Cursor in Batches. Dateien werden erst nach der Transaktion aus dem Speicher gelesen und
 * gegen ihre Prüfsumme geprüft; `checksums.json` folgt als letzter Eintrag.
 *
 * `backup.json.files` nennt die geplanten Dateien; fehlende oder abweichende Objekte werden mit
 * Warnung ausgelassen – maßgeblich für vorhandene Dateien ist `checksums.json`.
 * Core-Services (Audit, Benutzer …) laufen nie innerhalb der offenen Transaktion (PGlite).
 */
import { createHash, randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { sql, type SQL } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { version as APP_VERSION } from '../../../../../package.json';
import { auditFromContext } from '../audit/service';
import { getAuth } from '../auth';
import { getDb, type DbOrTx, type Tx } from '../database/client';
import { env } from '../env';
import { errors, isCoreError } from '../errors';
import { getDefinition } from '../modules/registry';
import { readObjectUnchecked } from '../storage';
import {
	acquireMaintenanceLock,
	releaseMaintenanceLock,
	verifyReauth
} from '../system/maintenance';
import { requireBackupUser } from './access';
import { createArchiveWriter, ndjsonSource } from './archive';
import { createEnvelopeWriter } from './envelope';
import { IDENTIFIER, selfReference, sortRowsSelfRef } from './introspect';
import { fileSink } from './io';
import { listBackupScopes, planTables, resolveScopes } from './scopes';
import { encodeRowSecrets, keyCheckValue, secretPurposeFor } from './secrets';
import { assertFreeSpace, newTempPath, removeTemp, sweepTempFiles } from './tempfiles';
import {
	BACKUP_FILE_EXT,
	BACKUP_FORMAT,
	BACKUP_FORMAT_VERSION,
	BACKUP_LIMITS,
	ENTRY_CHECKSUMS,
	ENTRY_FILE,
	ENTRY_META,
	dataEntryName,
	exportInput,
	fileEntryName,
	type BackupMeta,
	type BackupScopeInfo,
	type ByteSink,
	type Checksums,
	type ExportInput,
	type ExportResult,
	type PlannedTable,
	type TableInfo
} from './types';

type Row = Record<string, unknown>;

async function rowsOf(db: DbOrTx, query: SQL): Promise<Row[]> {
	return ((await db.execute(query)) as unknown as { rows: Row[] }).rows;
}

// ---------------------------------------------------------------------------
// Uhr und Download-Speicher
// ---------------------------------------------------------------------------

let clock: () => number = () => Date.now();

/** Nur für Tests: verschobene Uhr (Ablauf der Download-Token) */
export function setBackupClockForTests(fn: (() => number) | undefined): void {
	clock = fn ?? (() => Date.now());
}

interface DownloadEntry {
	userId: string;
	path: string;
	fileName: string;
	size: number;
	expiresAt: number;
}

const downloads = new Map<string, DownloadEntry>();
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

function sweepDownloads(): void {
	const now = clock();
	for (const [k, v] of downloads) {
		if (v.expiresAt > now) continue;
		downloads.delete(k);
		void removeTemp(v.path);
	}
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

/** Einträge je `schema.tabelle` (gleiche Tabelle aus mehreren Bereichen → ein Eintrag, Filter per OR) */
interface ExportGroup {
	schema: string;
	table: string;
	scopes: string[];
	/** `null` = ganze Tabelle */
	where: string | null;
	info: TableInfo;
	rows: number;
}

function groupTables(planned: PlannedTable[], info: TableInfo[]): ExportGroup[] {
	const byKey = new Map(info.map((t) => [`${t.schema}.${t.table}`, t]));
	const groups = new Map<string, ExportGroup & { wheres: (string | undefined)[] }>();
	for (const p of planned) {
		if (!IDENTIFIER.test(p.schema) || !IDENTIFIER.test(p.table)) continue;
		const k = `${p.schema}.${p.table}`;
		const t = byKey.get(k);
		if (!t) continue;
		let g = groups.get(k);
		if (!g) {
			g = {
				schema: p.schema,
				table: p.table,
				scopes: [],
				where: null,
				info: t,
				rows: 0,
				wheres: []
			};
			groups.set(k, g);
		}
		if (!g.scopes.includes(p.scope)) g.scopes.push(p.scope);
		g.wheres.push(p.where);
	}
	return [...groups.values()].map(({ wheres, ...g }) => ({
		...g,
		where: wheres.some((w) => !w) ? null : wheres.map((w) => `(${w})`).join(' OR ')
	}));
}

const fromSql = (g: ExportGroup) =>
	`"${g.schema}"."${g.table}" t${g.where ? ` WHERE ${g.where}` : ''}`;

function orderSql(t: TableInfo): string {
	const pk = t.primaryKey.filter((c) => IDENTIFIER.test(c));
	return pk.length && pk.length === t.primaryKey.length
		? ` ORDER BY ${pk.map((c) => `t."${c}"`).join(', ')}`
		: '';
}

/** Zeilen per Cursor im Snapshot der Transaktion (stabil auch ohne Primärschlüssel). */
async function* cursorLines(tx: Tx, g: ExportGroup, name: string): AsyncGenerator<string> {
	await tx.execute(
		sql.raw(
			`DECLARE ${name} NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS j FROM ${fromSql(g)}${orderSql(g.info)}`
		)
	);
	try {
		for (;;) {
			const rows = await rowsOf(tx, sql.raw(`FETCH ${BACKUP_LIMITS.rowBatch} FROM ${name}`));
			for (const r of rows) yield String(r.j);
			if (rows.length < BACKUP_LIMITS.rowBatch) break;
		}
	} finally {
		try {
			await tx.execute(sql.raw(`CLOSE ${name}`));
		} catch {
			// Transaktion bereits abgebrochen
		}
	}
}

interface EncodeStats {
	undecryptable: number;
}

/**
 * Geheimnisse einer ndjson-Zeile ersetzen. Die übrigen Werte bleiben als Originaltext erhalten
 * (kein Genauigkeitsverlust bei `bigint`/`numeric` durch `JSON.parse`).
 */
async function encodeLine(
	t: TableInfo,
	raw: string,
	mode: 'none' | 'always' | 'prefix',
	stats: EncodeStats
): Promise<string> {
	// Zeilenumbrüche können nur als Leerraum (z. B. aus `json`-Spalten) vorkommen
	const line = raw.includes('\n') || raw.includes('\r') ? raw.replace(/[\r\n]/g, ' ') : raw;
	if (mode === 'none' || (mode === 'prefix' && !line.includes('"enc:v1:'))) return line;
	const row = JSON.parse(line) as Row;
	const res = await encodeRowSecrets(t, row);
	stats.undecryptable += res.undecryptable;
	if (res.row === row) return line;
	let out = line;
	for (const col of t.columns) {
		const before = row[col.name];
		const after = res.row[col.name];
		if (before === after) continue;
		const key = JSON.stringify(col.name);
		const from = `${key}:${JSON.stringify(before)}`;
		const idx = out.indexOf(from);
		if (idx < 0) return JSON.stringify(res.row);
		out = `${out.slice(0, idx)}${key}:${JSON.stringify(after)}${out.slice(idx + from.length)}`;
	}
	return out;
}

function encodeMode(t: TableInfo): 'none' | 'always' | 'prefix' {
	const purposes = t.columns.map((c) => secretPurposeFor(t.schema, t.table, c.name));
	if (purposes.includes('better-auth')) return 'always';
	return purposes.some((p) => p !== null) ? 'prefix' : 'none';
}

async function* groupLines(
	tx: Tx,
	g: ExportGroup,
	cursorName: string,
	stats: EncodeStats
): AsyncGenerator<string> {
	const mode = encodeMode(g.info);
	if (!selfReference(g.info)) {
		for await (const line of cursorLines(tx, g, cursorName)) {
			yield await encodeLine(g.info, line, mode, stats);
		}
		return;
	}
	// Eigenbezug: komplett laden und Eltern vor Kinder sortieren
	const lines = new Map<Row, string>();
	for await (const line of cursorLines(tx, g, cursorName)) {
		if (lines.size >= BACKUP_LIMITS.maxSelfRefRows) {
			throw errors.badRequest(`Tabelle ${g.schema}.${g.table} ist zu groß für die Sicherung`);
		}
		lines.set(JSON.parse(line) as Row, line);
	}
	for (const row of sortRowsSelfRef([...lines.keys()], g.info)) {
		yield await encodeLine(g.info, lines.get(row)!, mode, stats);
	}
}

function stamp(ms: number): string {
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}`;
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Bereiche für die Auswahl im Export. */
export async function listScopesForBackup(ctx: RequestContext): Promise<BackupScopeInfo[]> {
	await requireBackupUser(ctx);
	return listBackupScopes();
}

interface FileToCopy {
	objectKey: string;
	checksum: string | null;
	size: number;
}

/** Sicherung erstellen; Ergebnis ist ein einmaliger Download (15 min, nur für denselben Benutzer). */
export async function startBackupExport(
	ctx: RequestContext,
	input: ExportInput
): Promise<ExportResult> {
	const userId = await requireBackupUser(ctx);
	const parsed = exportInput.safeParse(input);
	if (!parsed.success) throw errors.validation(parsed.error.issues);
	const data = parsed.data;
	await verifyReauth(userId, { password: data.password, totp: data.totp }, 'backup');

	const all = await listBackupScopes();
	const resolved = resolveScopes(data.scopes, all);
	if (resolved.unknown.length) {
		throw errors.validation([
			{ path: ['scopes'], message: `Unbekannter Bereich: ${resolved.unknown.join(', ')}` }
		]);
	}
	if (!resolved.scopes.length) {
		throw errors.validation([
			{ path: ['scopes'], message: 'Bitte mindestens einen Bereich wählen' }
		]);
	}

	acquireMaintenanceLock('Datensicherung');
	let path: string | null = null;
	let rawSink: ByteSink | null = null;
	let summary: ExportResult['summary'];
	let fileName: string;
	try {
		await sweepTempFiles();
		// Better-Auth-Kontext vorab laden (nicht erst in der Transaktion)
		await getAuth().$context;
		const startedAt = clock();
		fileName = `ep-intern-sicherung-${stamp(startedAt)}${BACKUP_FILE_EXT}`;
		path = await newTempPath(BACKUP_FILE_EXT);
		rawSink = await fileSink(path);
		const envelope = await createEnvelopeWriter(rawSink, data.backupPassword);
		const writer = createArchiveWriter(envelope);
		const warnings: string[] = [];
		const stats: EncodeStats = { undecryptable: 0 };
		const rowsByEntry = new Map<string, number>();
		const keyCheck = keyCheckValue();

		// 1) Datenbank in einem Snapshot
		const { groups, files } = await getDb().transaction(
			async (tx) => {
				const { tables, info } = await planTables(tx, resolved.scopes);
				const groups = groupTables(tables, info);
				for (const g of groups) {
					const [r] = await rowsOf(tx, sql.raw(`SELECT count(*)::int AS n FROM ${fromSql(g)}`));
					g.rows = Number(r?.n ?? 0);
				}

				const files: FileToCopy[] = [];
				const fileGroup = groups.find((g) => g.schema === 'public' && g.table === 'file');
				if (data.includeFiles && fileGroup) {
					const where = fileGroup.where ? ` AND (${fileGroup.where})` : '';
					for (const r of await rowsOf(
						tx,
						sql.raw(
							`SELECT object_key, checksum, size FROM "public"."file" t WHERE status = 'ready'${where} ORDER BY object_key`
						)
					)) {
						files.push({
							objectKey: String(r.object_key),
							checksum: r.checksum == null ? null : String(r.checksum),
							size: Number(r.size ?? 0)
						});
					}
				}
				const fileBytes = files.reduce((s, f) => s + f.size, 0);
				await assertFreeSpace(fileBytes + 64 * 1024 * 1024);

				const [creator] = await rowsOf(
					tx,
					sql`SELECT name FROM "public"."user" WHERE id = ${userId}`
				);
				const [hasDrizzle] = await rowsOf(
					tx,
					sql`SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS ok`
				);
				const coreMigrations =
					hasDrizzle?.ok === true || hasDrizzle?.ok === 't'
						? (
								await rowsOf(
									tx,
									sql`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at, id`
								)
							).map((r) => String(r.hash))
						: [];

				const modules: BackupMeta['modules'] = {};
				for (const s of resolved.scopes) {
					if (s.startsWith('core:')) continue;
					const [st] = await rowsOf(
						tx,
						sql`SELECT enabled, installed_version FROM "public"."module_state" WHERE id = ${s}`
					);
					const migrations = await rowsOf(
						tx,
						sql`SELECT name, checksum FROM "public"."module_migration" WHERE module_id = ${s} ORDER BY name`
					);
					modules[s] = {
						name: getDefinition(s)?.manifest.name ?? s,
						installedVersion: st?.installed_version == null ? null : String(st.installed_version),
						enabled: st?.enabled === true || st?.enabled === 't',
						migrations: migrations.map((m) => ({
							name: String(m.name),
							checksum: String(m.checksum)
						}))
					};
				}

				const meta: BackupMeta = {
					format: BACKUP_FORMAT,
					formatVersion: BACKUP_FORMAT_VERSION,
					createdAt: new Date(startedAt).toISOString(),
					appVersion: String(APP_VERSION ?? '0.0.0'),
					sourceOrigin: env().ORIGIN ?? null,
					createdBy: { id: userId, name: creator?.name == null ? '' : String(creator.name) },
					scopes: resolved.scopes,
					includesFiles: data.includeFiles,
					coreMigrations,
					modules,
					tables: groups.map((g) => ({
						name: `${g.schema}.${g.table}`,
						scope: g.scopes.join(','),
						columns: g.info.columns.map((c) => ({ name: c.name, type: c.type })),
						primaryKey: g.info.primaryKey,
						rows: g.rows
					})),
					files: { count: files.length, bytes: fileBytes },
					keyCheck
				};
				await writer.addEntry(ENTRY_META, json(meta));

				let i = 0;
				for (const g of groups) {
					const name = dataEntryName(g.schema, g.table);
					rowsByEntry.set(name, g.rows);
					await writer.addEntry(name, ndjsonSource(groupLines(tx, g, `ep_backup_c${i++}`, stats)));
				}
				return { groups, files };
			},
			{ isolationLevel: 'repeatable read', accessMode: 'read only' }
		);

		// 2) Dateien (außerhalb der Transaktion)
		let fileCount = 0;
		for (const f of files) {
			if (!ENTRY_FILE.test(fileEntryName(f.objectKey))) {
				warnings.push(`Datei ${f.objectKey} hat einen ungültigen Schlüssel und wurde ausgelassen`);
				continue;
			}
			let bytes: Uint8Array | null;
			try {
				bytes = await readObjectUnchecked(f.objectKey);
			} catch (e) {
				if (isCoreError(e) && e.code === 'unavailable') throw e;
				warnings.push(`Datei ${f.objectKey} konnte nicht gelesen werden und wurde ausgelassen`);
				continue;
			}
			if (!bytes) {
				warnings.push(`Datei ${f.objectKey} fehlt im Speicher und wurde ausgelassen`);
				continue;
			}
			if (f.checksum) {
				const sum = createHash('sha256').update(bytes).digest('hex');
				if (sum !== f.checksum.toLowerCase()) {
					warnings.push(`Datei ${f.objectKey} ist beschädigt (Prüfsumme) und wurde ausgelassen`);
					continue;
				}
			}
			await writer.addEntry(fileEntryName(f.objectKey), bytes, { level: 1 });
			fileCount++;
		}
		if (stats.undecryptable) {
			warnings.push(
				`${stats.undecryptable} verschlüsselte Werte konnten nicht entschlüsselt werden und wurden unverändert übernommen`
			);
		}

		// 3) Prüfsummen, abschließen
		const entries: Checksums['entries'] = {};
		for (const [name, s] of Object.entries(writer.stats())) {
			const rows = rowsByEntry.get(name);
			entries[name] = { sha256: s.sha256, bytes: s.bytes, ...(rows !== undefined ? { rows } : {}) };
		}
		await writer.addEntry(ENTRY_CHECKSUMS, json({ entries } satisfies Checksums));
		await writer.finish();
		rawSink = null;

		const size = (await stat(path)).size;
		summary = {
			scopes: resolved.scopes,
			tables: groups.length,
			rows: groups.reduce((s, g) => s + g.rows, 0),
			files: fileCount,
			bytes: size,
			warnings
		};
	} catch (e) {
		if (rawSink) await rawSink.close().catch(() => {});
		if (path) await removeTemp(path);
		throw e;
	} finally {
		releaseMaintenanceLock();
	}

	sweepDownloads();
	const downloadId = randomBytes(24).toString('base64url');
	downloads.set(hashToken(downloadId), {
		userId,
		path,
		fileName,
		size: summary.bytes,
		expiresAt: clock() + BACKUP_LIMITS.tokenTtlMs
	});

	await auditFromContext(ctx, 'core.system.backup_exported', {
		metadata: {
			scopes: summary.scopes,
			tables: summary.tables,
			rows: summary.rows,
			files: summary.files,
			bytes: summary.bytes,
			includesFiles: data.includeFiles
		}
	});
	return { downloadId, fileName, summary };
}

/**
 * Download einlösen (einmalig, benutzergebunden). `done()` löscht die Datei nach dem Senden.
 * Unbekannt, abgelaufen oder fremd → 404.
 */
export async function takeBackupDownload(
	ctx: RequestContext,
	downloadId: string
): Promise<{ path: string; fileName: string; size: number; done(): Promise<void> }> {
	const userId = await requireBackupUser(ctx);
	sweepDownloads();
	const key = typeof downloadId === 'string' ? hashToken(downloadId) : '';
	const entry = downloads.get(key);
	if (!entry || entry.userId !== userId) {
		throw errors.notFound('Download nicht gefunden oder abgelaufen');
	}
	downloads.delete(key);
	return {
		path: entry.path,
		fileName: entry.fileName,
		size: entry.size,
		done: () => removeTemp(entry.path)
	};
}
