/**
 * Datensicherung – Upload einer Sicherungsdatei in Stücken (`UPLOAD_CHUNK_BYTES`), damit `BODY_SIZE_LIMIT`
 * nicht angehoben werden muss. Sitzungen liegen im Speicher (ein Prozess), sind an den Benutzer gebunden und
 * verfallen nach `uploadTtlMs` ohne Aktivität. Die Bytes landen in einer Temp-Datei (0600).
 */
import { randomUUID } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import type { RequestContext } from '$lib/sdk/types';
import { CoreError, errors } from '../errors';
import { requireBackupUser } from './access';
import { assertFreeSpace, newTempPath, removeTemp } from './tempfiles';
import {
	BACKUP_FILE_EXT,
	BACKUP_LIMITS,
	UPLOAD_CHUNK_BYTES,
	uploadCreateInput,
	type UploadCreated,
	type UploadCreateInput,
	type UploadProgress
} from './types';
import { intlLocale, t } from '$lib/i18n';

/** Toleranz über der Chunkgröße (Client rundet evtl. anders) */
const CHUNK_TOLERANCE = 64 * 1024;
/** gleichzeitige Uploads je Benutzer (ältester fällt weg) */
const MAX_UPLOADS_PER_USER = 3;

interface UploadSession {
	id: string;
	userId: string;
	path: string;
	size: number;
	received: number;
	expiresAt: number;
	busy: boolean;
	/** von einer Analyse/Wiederherstellung belegt → verfällt nicht */
	held: number;
}

const uploads = new Map<string, UploadSession>();

let clock: () => number = () => Date.now();

/** Nur für Tests: verschobene Uhr */
export function setUploadClockForTests(fn: (() => number) | undefined): void {
	clock = fn ?? (() => Date.now());
}

export function maxBackupBytes(): number {
	const env = Number(process.env.BACKUP_MAX_BYTES);
	return Number.isFinite(env) && env > 0 ? env : BACKUP_LIMITS.maxFileBytes;
}

function sweepUploads(): void {
	const now = clock();
	for (const [id, u] of uploads) {
		if (u.held > 0 || u.busy || u.expiresAt > now) continue;
		uploads.delete(id);
		void removeTemp(u.path);
	}
}

function formatBytes(n: number): string {
	if (n >= 1024 ** 3)
		return `${(n / 1024 ** 3).toLocaleString(intlLocale(), { maximumFractionDigits: 1 })} GB`;
	return `${Math.round(n / 1024 ** 2).toLocaleString(intlLocale())} MB`;
}

function sessionFor(ctx: RequestContext, uploadId: string): UploadSession {
	sweepUploads();
	const u = typeof uploadId === 'string' ? uploads.get(uploadId) : undefined;
	if (!u || u.userId !== ctx.userId) {
		throw errors.notFound(t('backup.upload.notFound'));
	}
	return u;
}

const progressOf = (u: UploadSession): UploadProgress => ({
	received: u.received,
	size: u.size,
	complete: u.received === u.size
});

export async function createUpload(
	ctx: RequestContext,
	input: UploadCreateInput
): Promise<UploadCreated> {
	const userId = await requireBackupUser(ctx);
	const parsed = uploadCreateInput.safeParse(input);
	if (!parsed.success) throw errors.validation(parsed.error.issues);
	const { size } = parsed.data;
	const max = maxBackupBytes();
	if (size > max) {
		throw errors.tooLarge(t('backup.upload.tooLarge', { max: formatBytes(max) }));
	}
	sweepUploads();
	await assertFreeSpace(size + 64 * 1024 * 1024);

	const mine = [...uploads.values()]
		.filter((u) => u.userId === userId && u.held === 0 && !u.busy)
		.sort((a, b) => a.expiresAt - b.expiresAt);
	while (mine.length >= MAX_UPLOADS_PER_USER) {
		const old = mine.shift()!;
		uploads.delete(old.id);
		await removeTemp(old.path);
	}

	const path = await newTempPath(BACKUP_FILE_EXT);
	await writeFile(path, new Uint8Array(0), { mode: 0o600 });
	const id = randomUUID();
	uploads.set(id, {
		id,
		userId,
		path,
		size,
		received: 0,
		expiresAt: clock() + BACKUP_LIMITS.uploadTtlMs,
		busy: false,
		held: 0
	});
	return { uploadId: id, chunkBytes: UPLOAD_CHUNK_BYTES };
}

async function readBody(body: ReadableStream<Uint8Array>, expected: number): Promise<Uint8Array> {
	const out = new Uint8Array(expected);
	let off = 0;
	const reader = body.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value?.length) continue;
			if (off + value.length > expected) {
				throw errors.badRequest(t('backup.upload.chunkLarger'));
			}
			out.set(value, off);
			off += value.length;
		}
	} finally {
		reader.releaseLock();
	}
	if (off !== expected) throw errors.badRequest(t('backup.upload.chunkIncomplete'));
	return out;
}

/** Ein Stück anhängen; `offset` muss dem bisher empfangenen Stand entsprechen (sonst 409 mit Stand). */
export async function appendUpload(
	ctx: RequestContext,
	uploadId: string,
	offset: number,
	body: ReadableStream<Uint8Array> | null,
	contentLength: number
): Promise<UploadProgress> {
	await requireBackupUser(ctx);
	const u = sessionFor(ctx, uploadId);
	if (u.busy || u.held > 0) throw errors.conflict(t('backup.upload.busy'));
	if (!Number.isSafeInteger(offset) || offset !== u.received) {
		throw new CoreError('conflict', t('backup.upload.position'), progressOf(u));
	}
	if (!body || !Number.isSafeInteger(contentLength) || contentLength <= 0) {
		throw errors.badRequest(t('backup.upload.chunkEmpty'));
	}
	if (contentLength > UPLOAD_CHUNK_BYTES + CHUNK_TOLERANCE) {
		throw errors.tooLarge(t('backup.upload.chunkTooLarge'));
	}
	if (u.received + contentLength > u.size) {
		throw errors.badRequest(t('backup.upload.chunkBeyond'));
	}
	u.busy = true;
	try {
		const bytes = await readBody(body, contentLength);
		const fh = await open(u.path, 'r+');
		try {
			await fh.write(bytes, 0, bytes.length, u.received);
		} catch (e) {
			await fh.truncate(u.received).catch(() => {});
			throw e;
		} finally {
			await fh.close();
		}
		u.received += bytes.length;
		u.expiresAt = clock() + BACKUP_LIMITS.uploadTtlMs;
		return progressOf(u);
	} finally {
		u.busy = false;
	}
}

/** Pfad der vollständig hochgeladenen Datei (nur für den eigenen Upload). */
export function uploadPath(ctx: RequestContext, uploadId: string): string {
	const u = sessionFor(ctx, uploadId);
	if (u.busy || u.received !== u.size) {
		throw errors.conflict(t('backup.upload.incomplete'));
	}
	u.expiresAt = clock() + BACKUP_LIMITS.uploadTtlMs;
	return u.path;
}

/** Upload belegen (verfällt nicht, keine weiteren Stücke) bzw. wieder freigeben. */
export function holdUpload(uploadId: string, hold: boolean): void {
	const u = uploads.get(uploadId);
	if (!u) return;
	u.held = Math.max(0, u.held + (hold ? 1 : -1));
	u.expiresAt = clock() + BACKUP_LIMITS.uploadTtlMs;
}

export function dropUpload(uploadId: string): void {
	const u = uploads.get(uploadId);
	if (!u) return;
	uploads.delete(uploadId);
	void removeTemp(u.path);
}
