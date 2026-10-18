import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	PutObjectCommand
} from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ctxWith, settingsStore, systemCtx } from './_helpers';

vi.mock('$lib/server/core/settings/service', () => ({
	getSettings: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settingsStore[k]])),
	getSetting: async (k: string) => settingsStore[k]
}));
const auditLog = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('$lib/server/core/audit/service', () => ({ auditFromContext: auditLog }));

import * as storage from '$lib/server/core/storage';
import type { FileRow, S3Handle } from '$lib/server/core/storage';

function createFakes() {
	const objects = new Map<string, { body: Uint8Array; contentType?: string }>();
	const rows = new Map<string, FileRow>();
	const s3: S3Handle = {
		bucket: 'b',
		async send(cmd) {
			if (cmd instanceof PutObjectCommand) {
				objects.set(cmd.input.Key!, {
					body: cmd.input.Body as Uint8Array,
					contentType: cmd.input.ContentType
				});
				return {};
			}
			if (cmd instanceof GetObjectCommand) {
				const o = objects.get(cmd.input.Key!);
				if (!o) throw Object.assign(new Error('x'), { name: 'NoSuchKey' });
				return { Body: { transformToByteArray: async () => o.body } };
			}
			if (cmd instanceof HeadObjectCommand) {
				const o = objects.get(cmd.input.Key!);
				if (!o) throw Object.assign(new Error('x'), { name: 'NotFound' });
				return { ContentLength: o.body.byteLength };
			}
			if (cmd instanceof DeleteObjectCommand) {
				objects.delete(cmd.input.Key!);
				return {};
			}
			if (cmd instanceof HeadBucketCommand) return {};
			throw new Error('unbekanntes Kommando');
		},
		async presign(cmd, ttl) {
			return `https://s3.test/${cmd.input.Key}?ttl=${ttl}`;
		}
	};
	const repo: storage.FileRepo = {
		async findByPath(m, p) {
			return [...rows.values()].find((r) => r.moduleId === m && r.path === p);
		},
		async findById(id) {
			return rows.get(id);
		},
		async insert(r) {
			rows.set(r.id, r);
		},
		async update(id, patch) {
			rows.set(id, { ...rows.get(id)!, ...patch });
		},
		async delete(id) {
			rows.delete(id);
		},
		async listByPrefix(m, prefix) {
			return [...rows.values()].filter(
				(r) => r.moduleId === m && r.path.startsWith(prefix) && r.status === 'ready'
			);
		},
		async usage() {
			const map = new Map<string, { moduleId: string; files: number; bytes: number }>();
			for (const r of rows.values()) {
				const u = map.get(r.moduleId) ?? { moduleId: r.moduleId, files: 0, bytes: 0 };
				u.files++;
				u.bytes += r.size;
				map.set(r.moduleId, u);
			}
			return [...map.values()];
		}
	};
	return { objects, rows, s3, repo };
}

let fakes: ReturnType<typeof createFakes>;
const bytes = (s: string) => new TextEncoder().encode(s);
const txt = (module: string, path: string, content = 'x') => ({
	module,
	path,
	file: bytes(content),
	contentType: 'text/plain'
});

beforeEach(() => {
	fakes = createFakes();
	Object.assign(settingsStore, {
		'core.storage.endpoint': '',
		'core.storage.region': 'auto',
		'core.storage.bucket': 'b',
		'core.storage.accessKeyId': 'AK',
		'core.storage.secretAccessKey': 'SK',
		'core.storage.forcePathStyle': false,
		'core.storage.maxFileSizeMb': 1,
		'core.storage.allowedContentTypes': []
	});
	storage.setS3ClientFactoryForTests(() => fakes.s3);
	storage.setFileRepoForTests(fakes.repo);
	auditLog.mockClear();
});

describe('Storage-Service', () => {
	it('lädt hoch und herunter und trennt Modulbereiche', async () => {
		const ctx = ctxWith('members.storage.write', 'members.storage.read');
		const f = await storage.upload(ctx, txt('members', 'documents/a.txt', 'hallo'));
		expect(f.size).toBe(5);
		const key = [...fakes.rows.values()][0]!.objectKey;
		expect(key.startsWith('members/')).toBe(true);
		const dl = await storage.download(ctx, { module: 'members', path: 'documents/a.txt' });
		expect(new TextDecoder().decode(dl.buffer)).toBe('hallo');
		await expect(
			storage.download(ctx, { module: 'other', path: 'documents/a.txt' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('ersetzt bestehende Dateien und löscht das alte Objekt', async () => {
		const ctx = ctxWith('core.storage.manage');
		await storage.upload(ctx, txt('members', 'a.txt', '1'));
		await storage.upload(ctx, txt('members', 'a.txt', '22'));
		expect(fakes.rows.size).toBe(1);
		expect(fakes.objects.size).toBe(1);
	});

	it('lehnt Pfad-Traversal und ungültige Pfade ab', async () => {
		const ctx = ctxWith('members.storage.write');
		for (const path of ['../x', 'a/../b', '/abs', 'a//b', 'a\\b', 'a\u0000b', 'x/']) {
			await expect(storage.upload(ctx, txt('members', path))).rejects.toMatchObject({
				code: 'bad_request'
			});
		}
	});

	it('erzwingt Größenlimit und Content-Type-Allowlist', async () => {
		const ctx = ctxWith('members.storage.write');
		await expect(
			storage.upload(ctx, {
				module: 'members',
				path: 'big.pdf',
				file: new Uint8Array(1024 * 1024 + 1),
				contentType: 'application/pdf'
			})
		).rejects.toMatchObject({ code: 'payload_too_large' });
		for (const ct of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
			await expect(
				storage.upload(ctx, { ...txt('members', 'x'), contentType: ct })
			).rejects.toMatchObject({ code: 'bad_request' });
		}
		settingsStore['core.storage.allowedContentTypes'] = ['image/svg+xml'];
		await expect(
			storage.upload(ctx, { ...txt('members', 'x.svg', '<svg/>'), contentType: 'image/svg+xml' })
		).resolves.toBeTruthy();
	});

	it('prüft Berechtigungen; System-Akteur darf alles', async () => {
		await expect(storage.upload(ctxWith(), txt('members', 'a.txt'))).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(storage.upload(systemCtx, txt('members', 'a.txt'))).resolves.toBeTruthy();
		await expect(
			storage.remove(ctxWith('members.storage.read'), { module: 'members', path: 'a.txt' })
		).rejects.toMatchObject({ code: 'forbidden' });
	});

	it('löscht Dateien und schreibt ein Audit-Event', async () => {
		const ctx = ctxWith('members.storage.write', 'members.storage.delete');
		await storage.upload(ctx, txt('members', 'a.txt'));
		await storage.remove(ctx, { module: 'members', path: 'a.txt' });
		expect(fakes.objects.size).toBe(0);
		expect(fakes.rows.size).toBe(0);
		expect(auditLog).toHaveBeenCalledOnce();
	});

	it('liefert virtuelle Ordner', async () => {
		const ctx = ctxWith('members.storage.write', 'members.storage.read');
		for (const p of ['a.txt', 'docs/b.txt', 'docs/sub/c.txt', 'img/d.txt']) {
			await storage.upload(ctx, txt('members', p));
		}
		const root = await storage.list(ctx, { module: 'members' });
		expect(root.files.map((f) => f.path)).toEqual(['a.txt']);
		expect(root.folders).toEqual(['docs', 'img']);
		const docs = await storage.list(ctx, { module: 'members', prefix: 'docs' });
		expect(docs.files.map((f) => f.path)).toEqual(['docs/b.txt']);
		expect(docs.folders).toEqual(['sub']);
	});

	it('signierter Upload: pending bis zur Bestätigung, Größe wird geprüft', async () => {
		const ctx = ctxWith('members.storage.write', 'members.storage.read');
		const signed = await storage.createSignedUploadUrl(ctx, {
			module: 'members',
			path: 'big/x.pdf',
			contentType: 'application/pdf',
			size: 4
		});
		expect(signed.url).toContain('https://s3.test/members/');
		await expect(storage.stat(ctx, { module: 'members', path: 'big/x.pdf' })).rejects.toMatchObject(
			{
				code: 'not_found'
			}
		);
		const key = [...fakes.rows.values()][0]!.objectKey;
		fakes.objects.set(key, { body: new Uint8Array(9) });
		await expect(storage.confirmUpload(ctx, signed.fileId)).rejects.toMatchObject({
			code: 'bad_request'
		});
		expect(fakes.rows.size).toBe(0);

		const s2 = await storage.createSignedUploadUrl(ctx, {
			module: 'members',
			path: 'big/y.pdf',
			contentType: 'application/pdf',
			size: 4
		});
		fakes.objects.set([...fakes.rows.values()][0]!.objectKey, { body: new Uint8Array(4) });
		const ok = await storage.confirmUpload(ctx, s2.fileId);
		expect(ok.path).toBe('big/y.pdf');
		const dl = await storage.createSignedDownloadUrl(ctx, {
			module: 'members',
			path: 'big/y.pdf',
			expiresInSec: 99999
		});
		expect(dl.expiresInSec).toBe(3600);
	});

	it('nutzt Multipart-Upload für große Dateien', async () => {
		settingsStore['core.storage.maxFileSizeMb'] = 50;
		const putLarge = vi.fn(async (key: string, body: Uint8Array) => {
			fakes.objects.set(key, { body });
		});
		fakes.s3.putLarge = putLarge;
		await storage.upload(systemCtx, {
			module: 'core',
			path: 'big.zip',
			file: new Uint8Array(9 * 1024 * 1024),
			contentType: 'application/zip'
		});
		expect(putLarge).toHaveBeenCalledOnce();
	});

	it('ermittelt Speicherverbrauch pro Modul und meldet fehlende Konfiguration', async () => {
		await storage.upload(systemCtx, txt('members', 'a.txt', 'abc'));
		const usage = await storage.usageByModule(ctxWith('core.storage.manage'));
		expect(usage).toEqual([{ moduleId: 'members', files: 1, bytes: 3 }]);
		await expect(storage.usageByModule(ctxWith())).rejects.toMatchObject({ code: 'forbidden' });
		settingsStore['core.storage.bucket'] = '';
		await expect(storage.testConnection()).rejects.toMatchObject({ code: 'unavailable' });
	});
});
