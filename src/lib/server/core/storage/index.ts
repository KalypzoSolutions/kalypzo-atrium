import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { and, eq, like, sql } from 'drizzle-orm';
import type { RequestContext, StoredFile } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema } from '../database/client';
import { errors, isCoreError } from '../errors';
import { has } from '../permissions/service';
import { getSettings } from '../settings/service';
import { newId } from '../util';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

type S3Command =
	PutObjectCommand | GetObjectCommand | HeadObjectCommand | DeleteObjectCommand | HeadBucketCommand;

/** Minimale S3-Schnittstelle; erlaubt Testadapter ohne echten S3Client. */
export interface S3Handle {
	bucket: string;
	send(command: S3Command): Promise<unknown>;
	presign(command: GetObjectCommand | PutObjectCommand, expiresInSec: number): Promise<string>;
	/** Mehrteiliger Upload für große Dateien (optional, sonst PutObject) */
	putLarge?(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface FileRow {
	id: string;
	moduleId: string;
	path: string;
	name: string;
	objectKey: string;
	size: number;
	contentType: string;
	checksum: string | null;
	status: 'pending' | 'ready';
	createdBy: string | null;
	createdAt: Date;
}

/** Persistenz der Dateimetadaten (PostgreSQL); austauschbar für Tests. */
export interface FileRepo {
	findByPath(moduleId: string, path: string): Promise<FileRow | undefined>;
	findById(id: string): Promise<FileRow | undefined>;
	insert(row: FileRow): Promise<void>;
	update(id: string, patch: Partial<Omit<FileRow, 'id'>>): Promise<void>;
	delete(id: string): Promise<void>;
	listByPrefix(moduleId: string, prefix: string): Promise<FileRow[]>;
	/** Wie `listByPrefix`, aber inkl. `pending` (für `purge`); fehlt es, gilt `listByPrefix` */
	listAllByPrefix?(moduleId: string, prefix: string): Promise<FileRow[]>;
	usage(): Promise<{ moduleId: string; files: number; bytes: number }[]>;
}

export interface StorageConfig {
	endpoint: string;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	forcePathStyle: boolean;
	maxFileSizeMb: number;
	allowedContentTypes: string[];
}

// ---------------------------------------------------------------------------
// Konstanten und Validierung
// ---------------------------------------------------------------------------

const MODULE_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
const MULTIPART_THRESHOLD = 8 * 1024 * 1024;
const DEFAULT_SIGNED_TTL = 300;
const MAX_SIGNED_TTL = 3600;

export const DEFAULT_ALLOWED_CONTENT_TYPES = [
	'application/pdf',
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/webp',
	'text/plain',
	'text/csv',
	'text/markdown',
	'application/json',
	'application/zip',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	'application/msword',
	'application/vnd.ms-excel',
	'application/vnd.ms-powerpoint'
];

// Aktive Inhalte: nur zulässig, wenn ausdrücklich in der Allowlist genannt
const ACTIVE_CONTENT_TYPES = new Set(['text/html', 'image/svg+xml', 'application/xhtml+xml']);

export function validateModuleId(module: string): void {
	if (!MODULE_PATTERN.test(module) && module !== 'core') {
		throw errors.badRequest('Ungültige Modul-ID');
	}
}

export function validatePath(path: string): void {
	if (typeof path !== 'string' || !path.length || path.length > 512) {
		throw errors.badRequest('Ungültiger Dateipfad');
	}
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f\\]/.test(path) || path.startsWith('/') || path.endsWith('/')) {
		throw errors.badRequest('Ungültiger Dateipfad');
	}
	for (const seg of path.split('/')) {
		if (!seg || seg === '.' || seg === '..') throw errors.badRequest('Ungültiger Dateipfad');
	}
}

function normalizeContentType(ct: string | undefined): string {
	return (ct ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
}

function contentTypeAllowed(ct: string, configured: string[]): boolean {
	const list = configured.length
		? configured.map((c) => c.toLowerCase())
		: DEFAULT_ALLOWED_CONTENT_TYPES;
	if (ACTIVE_CONTENT_TYPES.has(ct) && !list.includes(ct)) return false;
	return list.some((a) => (a.endsWith('/*') ? ct.startsWith(a.slice(0, -1)) : a === ct));
}

// ---------------------------------------------------------------------------
// Zugriffskontrolle
// ---------------------------------------------------------------------------

type Action = 'read' | 'write' | 'delete';

export function assertAccess(ctx: RequestContext, module: string, action: Action): void {
	validateModuleId(module);
	if (ctx.actor.type === 'system') return;
	if (!ctx.userId) throw errors.unauthenticated();
	if (has(ctx, `${module}.storage.${action}`) || has(ctx, 'core.storage.manage')) return;
	throw errors.forbidden(`Berechtigung fehlt: ${module}.storage.${action}`);
}

// ---------------------------------------------------------------------------
// Konfiguration und Client
// ---------------------------------------------------------------------------

export async function loadConfig(): Promise<StorageConfig> {
	const s = await getSettings([
		'core.storage.endpoint',
		'core.storage.region',
		'core.storage.bucket',
		'core.storage.accessKeyId',
		'core.storage.secretAccessKey',
		'core.storage.forcePathStyle',
		'core.storage.maxFileSizeMb',
		'core.storage.allowedContentTypes'
	]);
	return {
		endpoint: String(s['core.storage.endpoint'] ?? ''),
		region: String(s['core.storage.region'] || 'auto'),
		bucket: String(s['core.storage.bucket'] ?? ''),
		accessKeyId: String(s['core.storage.accessKeyId'] ?? ''),
		secretAccessKey: String(s['core.storage.secretAccessKey'] ?? ''),
		forcePathStyle: Boolean(s['core.storage.forcePathStyle']),
		maxFileSizeMb: Number(s['core.storage.maxFileSizeMb'] ?? 50),
		allowedContentTypes: (s['core.storage.allowedContentTypes'] as string[] | undefined) ?? []
	};
}

export type S3ClientFactory = (config: StorageConfig) => S3Handle;

function realFactory(config: StorageConfig): S3Handle {
	const client = new S3Client({
		region: config.region,
		endpoint: config.endpoint || undefined,
		forcePathStyle: config.forcePathStyle,
		credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
	});
	return {
		bucket: config.bucket,
		send: (command) => client.send(command as PutObjectCommand),
		presign: (command, expiresIn) => getSignedUrl(client, command, { expiresIn }),
		putLarge: async (key, body, contentType) => {
			await new Upload({
				client,
				params: { Bucket: config.bucket, Key: key, Body: body, ContentType: contentType },
				partSize: 8 * 1024 * 1024,
				queueSize: 3
			}).done();
		}
	};
}

let factory: S3ClientFactory = realFactory;
let repo: FileRepo | undefined;
const handleCache = new Map<string, S3Handle>();

export function setS3ClientFactoryForTests(f: S3ClientFactory | undefined): void {
	factory = f ?? realFactory;
	handleCache.clear();
}

export function setFileRepoForTests(r: FileRepo | undefined): void {
	repo = r;
}

async function connect(): Promise<{ s3: S3Handle; config: StorageConfig }> {
	const config = await loadConfig();
	if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
		throw errors.unavailable('S3-Storage ist nicht konfiguriert');
	}
	const cacheKey = JSON.stringify([
		config.endpoint,
		config.region,
		config.bucket,
		config.accessKeyId,
		config.secretAccessKey,
		config.forcePathStyle
	]);
	let s3 = handleCache.get(cacheKey);
	if (!s3) {
		handleCache.clear();
		s3 = factory(config);
		handleCache.set(cacheKey, s3);
	}
	return { s3, config };
}

function mapS3Error(e: unknown): never {
	const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
	const status = err.$metadata?.httpStatusCode;
	if (err.name === 'NoSuchKey' || err.name === 'NotFound' || status === 404) {
		throw errors.notFound('Datei nicht im Speicher gefunden');
	}
	if (status === 403 || err.name === 'AccessDenied' || err.name === 'InvalidAccessKeyId') {
		throw errors.unavailable('Zugriff auf den S3-Storage wurde abgelehnt');
	}
	throw errors.unavailable('S3-Storage ist nicht erreichbar');
}

// ---------------------------------------------------------------------------
// Datenbank-Repository
// ---------------------------------------------------------------------------

function dbRepo(): FileRepo {
	const t = schema.file;
	return {
		async findByPath(moduleId, path) {
			const [r] = await getDb()
				.select()
				.from(t)
				.where(and(eq(t.moduleId, moduleId), eq(t.path, path)));
			return r;
		},
		async findById(id) {
			const [r] = await getDb().select().from(t).where(eq(t.id, id));
			return r;
		},
		async insert(row) {
			await getDb().insert(t).values(row);
		},
		async update(id, patch) {
			await getDb().update(t).set(patch).where(eq(t.id, id));
		},
		async delete(id) {
			await getDb().delete(t).where(eq(t.id, id));
		},
		async listByPrefix(moduleId, prefix) {
			const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
			return getDb()
				.select()
				.from(t)
				.where(and(eq(t.moduleId, moduleId), like(t.path, `${escaped}%`), eq(t.status, 'ready')));
		},
		async listAllByPrefix(moduleId, prefix) {
			const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
			return getDb()
				.select()
				.from(t)
				.where(and(eq(t.moduleId, moduleId), like(t.path, `${escaped}%`)));
		},
		async usage() {
			const rows = await getDb()
				.select({
					moduleId: t.moduleId,
					files: sql<number>`count(*)::int`,
					bytes: sql<number>`coalesce(sum(${t.size}), 0)::bigint`
				})
				.from(t)
				.where(eq(t.status, 'ready'))
				.groupBy(t.moduleId);
			return rows.map((r) => ({
				moduleId: r.moduleId,
				files: Number(r.files),
				bytes: Number(r.bytes)
			}));
		}
	};
}

const files = (): FileRepo => (repo ??= dbRepo());

function toStored(r: FileRow): StoredFile {
	return {
		id: r.id,
		module: r.moduleId,
		path: r.path,
		name: r.name,
		size: r.size,
		contentType: r.contentType,
		createdAt: r.createdAt.toISOString()
	};
}

async function sha256Hex(data: Uint8Array): Promise<string> {
	const { createHash } = await import('node:crypto');
	return createHash('sha256').update(data).digest('hex');
}

function maxBytes(config: StorageConfig): number {
	return config.maxFileSizeMb * 1024 * 1024;
}

function checkType(contentType: string, config: StorageConfig): void {
	if (!contentTypeAllowed(contentType, config.allowedContentTypes)) {
		throw errors.badRequest(`Dateityp nicht erlaubt: ${contentType}`);
	}
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

export interface UploadInput {
	module: string;
	path: string;
	file: Uint8Array | Buffer;
	contentType?: string;
	name?: string;
}

/** Legt eine Datei ab. Existiert der Pfad bereits, wird der Inhalt ersetzt. */
export async function upload(ctx: RequestContext, input: UploadInput): Promise<StoredFile> {
	assertAccess(ctx, input.module, 'write');
	validatePath(input.path);
	const { s3, config } = await connect();
	const size = input.file.byteLength;
	if (size > maxBytes(config))
		throw errors.tooLarge(`Datei überschreitet das Limit von ${config.maxFileSizeMb} MB`);
	const contentType = normalizeContentType(input.contentType);
	checkType(contentType, config);

	const objectKey = `${input.module}/${newId()}`;
	try {
		if (size > MULTIPART_THRESHOLD && s3.putLarge) {
			await s3.putLarge(objectKey, input.file, contentType);
		} else {
			await s3.send(
				new PutObjectCommand({
					Bucket: s3.bucket,
					Key: objectKey,
					Body: input.file,
					ContentType: contentType,
					ContentLength: size
				})
			);
		}
	} catch (e) {
		mapS3Error(e);
	}

	const existing = await files().findByPath(input.module, input.path);
	const name = input.name?.trim() || input.path.split('/').pop()!;
	const checksum = await sha256Hex(input.file);
	let row: FileRow;
	if (existing) {
		await files().update(existing.id, {
			objectKey,
			size,
			contentType,
			name,
			checksum,
			status: 'ready',
			createdBy: ctx.userId
		});
		row = {
			...existing,
			objectKey,
			size,
			contentType,
			name,
			checksum,
			status: 'ready',
			createdBy: ctx.userId
		};
		await s3
			.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: existing.objectKey }))
			.catch(() => undefined);
	} else {
		row = {
			id: newId(),
			moduleId: input.module,
			path: input.path,
			name,
			objectKey,
			size,
			contentType,
			checksum,
			status: 'ready',
			createdBy: ctx.userId,
			createdAt: new Date()
		};
		await files().insert(row);
	}
	return toStored(row);
}

async function requireFile(
	module: string,
	path: string,
	opts: { ready?: boolean } = {}
): Promise<FileRow> {
	validatePath(path);
	const row = await files().findByPath(module, path);
	if (!row || (opts.ready !== false && row.status !== 'ready'))
		throw errors.notFound('Datei nicht gefunden');
	return row;
}

export async function download(
	ctx: RequestContext,
	input: { module: string; path: string }
): Promise<{ buffer: Uint8Array; file: StoredFile }> {
	assertAccess(ctx, input.module, 'read');
	const row = await requireFile(input.module, input.path);
	const { s3 } = await connect();
	try {
		const res = (await s3.send(
			new GetObjectCommand({ Bucket: s3.bucket, Key: row.objectKey })
		)) as {
			Body?: { transformToByteArray(): Promise<Uint8Array> };
		};
		if (!res.Body) throw errors.notFound('Datei nicht im Speicher gefunden');
		return { buffer: await res.Body.transformToByteArray(), file: toStored(row) };
	} catch (e) {
		if (isCoreError(e)) throw e;
		return mapS3Error(e);
	}
}

export async function remove(
	ctx: RequestContext,
	input: { module: string; path: string }
): Promise<void> {
	assertAccess(ctx, input.module, 'delete');
	const row = await requireFile(input.module, input.path, { ready: false });
	const { s3 } = await connect();
	try {
		await s3.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: row.objectKey }));
	} catch (e) {
		mapS3Error(e);
	}
	await files().delete(row.id);
	await auditFromContext(ctx, 'core.storage.file_deleted', {
		target: `${input.module}/${input.path}`,
		metadata: { fileId: row.id, size: row.size }
	});
}

export async function stat(
	ctx: RequestContext,
	input: { module: string; path: string }
): Promise<StoredFile> {
	assertAccess(ctx, input.module, 'read');
	return toStored(await requireFile(input.module, input.path));
}

export interface ListResult {
	files: StoredFile[];
	folders: string[];
}

/** Virtuelle Ordner: ein Ordner ist jedes gemeinsame Pfadpräfix. */
export async function list(
	ctx: RequestContext,
	input: { module: string; prefix?: string }
): Promise<ListResult> {
	assertAccess(ctx, input.module, 'read');
	let prefix = input.prefix ?? '';
	if (prefix) {
		prefix = prefix.replace(/\/+$/, '');
		validatePath(prefix);
		prefix += '/';
	}
	const rows = await files().listByPrefix(input.module, prefix);
	const folders = new Set<string>();
	const direct: StoredFile[] = [];
	for (const r of rows) {
		if (!r.path.startsWith(prefix)) continue;
		const rest = r.path.slice(prefix.length);
		const slash = rest.indexOf('/');
		if (slash === -1) direct.push(toStored(r));
		else folders.add(rest.slice(0, slash));
	}
	return {
		files: direct.sort((a, b) => a.path.localeCompare(b.path)),
		folders: [...folders].sort()
	};
}

export async function createSignedUploadUrl(
	ctx: RequestContext,
	input: { module: string; path: string; contentType: string; size: number; expiresInSec?: number }
): Promise<{ url: string; fileId: string; headers: Record<string, string>; expiresInSec: number }> {
	assertAccess(ctx, input.module, 'write');
	validatePath(input.path);
	const { s3, config } = await connect();
	if (!Number.isInteger(input.size) || input.size <= 0)
		throw errors.badRequest('Ungültige Dateigröße');
	if (input.size > maxBytes(config))
		throw errors.tooLarge(`Datei überschreitet das Limit von ${config.maxFileSizeMb} MB`);
	const contentType = normalizeContentType(input.contentType);
	checkType(contentType, config);
	const expiresInSec = Math.min(input.expiresInSec ?? DEFAULT_SIGNED_TTL, MAX_SIGNED_TTL);

	const objectKey = `${input.module}/${newId()}`;
	const existing = await files().findByPath(input.module, input.path);
	// Der Inhalt einer bestehenden Datei bleibt bis zum Löschen unverändert.
	if (existing)
		throw errors.conflict('Pfad existiert bereits; zuerst löschen oder direkt hochladen');
	const fileId = newId();
	await files().insert({
		id: fileId,
		moduleId: input.module,
		path: input.path,
		name: input.path.split('/').pop()!,
		objectKey,
		size: input.size,
		contentType,
		checksum: null,
		status: 'pending',
		createdBy: ctx.userId,
		createdAt: new Date()
	});
	const url = await s3
		.presign(
			new PutObjectCommand({
				Bucket: s3.bucket,
				Key: objectKey,
				ContentType: contentType,
				ContentLength: input.size
			}),
			expiresInSec
		)
		.catch(mapS3Error);
	return { url, fileId, headers: { 'Content-Type': contentType }, expiresInSec };
}

/** Bestätigt einen per signierter URL hochgeladenen Upload (prüft Existenz und Größe). */
export async function confirmUpload(ctx: RequestContext, fileId: string): Promise<StoredFile> {
	const row = await files().findById(fileId);
	if (!row) throw errors.notFound('Datei nicht gefunden');
	assertAccess(ctx, row.moduleId, 'write');
	if (row.status === 'ready') return toStored(row);
	const { s3, config } = await connect();
	let length: number | undefined;
	try {
		const head = (await s3.send(
			new HeadObjectCommand({ Bucket: s3.bucket, Key: row.objectKey })
		)) as {
			ContentLength?: number;
		};
		length = head.ContentLength;
	} catch {
		throw errors.badRequest('Upload wurde nicht gefunden');
	}
	if (length === undefined || length > maxBytes(config) || length !== row.size) {
		await s3
			.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: row.objectKey }))
			.catch(() => undefined);
		await files().delete(row.id);
		throw errors.badRequest('Hochgeladene Datei entspricht nicht der angekündigten Größe');
	}
	await files().update(row.id, { status: 'ready' });
	return toStored({ ...row, status: 'ready' });
}

export async function createSignedDownloadUrl(
	ctx: RequestContext,
	input: { module: string; path: string; expiresInSec?: number }
): Promise<{ url: string; expiresInSec: number }> {
	assertAccess(ctx, input.module, 'read');
	const row = await requireFile(input.module, input.path);
	const { s3 } = await connect();
	const expiresInSec = Math.min(input.expiresInSec ?? DEFAULT_SIGNED_TTL, MAX_SIGNED_TTL);
	const url = await s3
		.presign(new GetObjectCommand({ Bucket: s3.bucket, Key: row.objectKey }), expiresInSec)
		.catch(mapS3Error);
	return { url, expiresInSec };
}

export async function usageByModule(
	ctx: RequestContext
): Promise<{ moduleId: string; files: number; bytes: number }[]> {
	if (ctx.actor.type !== 'system') {
		if (!ctx.userId) throw errors.unauthenticated();
		if (!has(ctx, 'core.storage.manage'))
			throw errors.forbidden('Berechtigung fehlt: core.storage.manage');
	}
	return files().usage();
}

/** Prüft Erreichbarkeit und Zugangsdaten des Buckets. */
export async function testConnection(ctx?: RequestContext): Promise<{ ok: true }> {
	if (ctx && ctx.actor.type !== 'system') {
		if (!has(ctx, 'core.storage.manage'))
			throw errors.forbidden('Berechtigung fehlt: core.storage.manage');
	}
	const { s3 } = await connect();
	try {
		await s3.send(new HeadBucketCommand({ Bucket: s3.bucket }));
	} catch (e) {
		mapS3Error(e);
	}
	return { ok: true };
}

/** Interner Zugriff per Datei-ID ohne Rechteprüfung (z. B. Logo für PDFs). Nie direkt an Clients durchreichen. */
export async function readFileByIdUnchecked(
	fileId: string
): Promise<{ buffer: Uint8Array; contentType: string } | null> {
	const row = await files().findById(fileId);
	if (!row || row.status !== 'ready') return null;
	const { s3 } = await connect();
	try {
		const res = (await s3.send(
			new GetObjectCommand({ Bucket: s3.bucket, Key: row.objectKey })
		)) as {
			Body?: { transformToByteArray(): Promise<Uint8Array> };
		};
		if (!res.Body) return null;
		return { buffer: await res.Body.transformToByteArray(), contentType: row.contentType };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Bereinigung (Purge)
// ---------------------------------------------------------------------------

export interface PurgeInput {
	module: string;
	/** Pfadpräfix (ohne führenden Schrägstrich); leer/weggelassen = alle Dateien des Moduls */
	prefix?: string;
	/** Exakte Pfade, die erhalten bleiben (z. B. Profilbild des ausführenden Admins) */
	exceptPaths?: string[];
}

export interface PurgeResult {
	count: number;
	bytes: number;
	warnings: string[];
}

const PURGE_BATCH = 10;

/** Dateien (inkl. `pending`), die `purge` löschen würde. Ohne Rechteprüfung – nur Core-intern. */
export async function listPurgeCandidates(input: PurgeInput): Promise<FileRow[]> {
	validateModuleId(input.module);
	const prefix = input.prefix ?? '';
	const repoNow = files();
	const rows = repoNow.listAllByPrefix
		? await repoNow.listAllByPrefix(input.module, prefix)
		: await repoNow.listByPrefix(input.module, prefix);
	const except = new Set(input.exceptPaths ?? []);
	return rows.filter((r) => r.path.startsWith(prefix) && !except.has(r.path));
}

/**
 * Löscht Dateien eines Moduls ohne Rechteprüfung (Core-intern, z. B. Admin-Reset). S3-Objekte
 * werden best-effort entfernt; ohne konfiguriertes S3 nur die Metadaten (mit Warnung).
 */
export async function purgeUnchecked(
	ctx: RequestContext,
	input: PurgeInput,
	opts: { audit?: boolean } = {}
): Promise<PurgeResult> {
	const rows = await listPurgeCandidates(input);
	const warnings: string[] = [];
	const bytes = rows.reduce((s, r) => s + Number(r.size || 0), 0);
	if (rows.length) {
		let s3: S3Handle | null = null;
		try {
			s3 = (await connect()).s3;
		} catch {
			warnings.push(
				`Speicher für ${input.module} nicht erreichbar/konfiguriert: nur Metadaten gelöscht (${rows.length} Dateien)`
			);
		}
		if (s3) {
			let failed = 0;
			for (let i = 0; i < rows.length; i += PURGE_BATCH) {
				const batch = rows.slice(i, i + PURGE_BATCH);
				const results = await Promise.allSettled(
					batch.map((r) =>
						s3!.send(new DeleteObjectCommand({ Bucket: s3!.bucket, Key: r.objectKey }))
					)
				);
				failed += results.filter((x) => x.status === 'rejected').length;
			}
			if (failed) {
				warnings.push(
					`${failed} Objekte von ${input.module} konnten nicht aus dem Speicher gelöscht werden`
				);
			}
		}
		for (const r of rows) await files().delete(r.id);
	}
	if (opts.audit !== false) {
		await auditFromContext(ctx, 'core.storage.purged', {
			target: input.module,
			metadata: {
				prefix: input.prefix ?? '',
				count: rows.length,
				bytes,
				warnings: warnings.length
			}
		});
	}
	return { count: rows.length, bytes, warnings };
}

/** Löscht alle Dateien eines Moduls (optional unter einem Präfix). Nur System oder `core.storage.manage`. */
export async function purge(ctx: RequestContext, input: PurgeInput): Promise<PurgeResult> {
	validateModuleId(input.module);
	if (ctx.actor.type !== 'system') {
		if (!ctx.userId) throw errors.unauthenticated();
		if (!has(ctx, 'core.storage.manage'))
			throw errors.forbidden('Berechtigung fehlt: core.storage.manage');
	}
	if (input.prefix) {
		const p = input.prefix.replace(/\/+$/, '');
		validatePath(p);
	}
	return purgeUnchecked(ctx, input);
}
