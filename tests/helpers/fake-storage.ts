/**
 * Fake-S3 und Fake-FileRepo für Integrationstests (Muster aus tests/unit/storage.test.ts).
 * `installFakeStorage(admin)` setzt die Storage-Einstellungen und hängt die Fakes ein.
 */
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	PutObjectCommand
} from '@aws-sdk/client-s3';
import { setSetting } from '$lib/server/core/settings/service';
import {
	setFileRepoForTests,
	setS3ClientFactoryForTests,
	type FileRepo,
	type FileRow,
	type S3Handle
} from '$lib/server/core/storage';
import type { RequestContext } from '$lib/sdk/types';

const objects = new Map<string, { body: Uint8Array; contentType?: string }>();
const rows = new Map<string, FileRow>();

const s3: S3Handle = {
	bucket: 'test-bucket',
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

const repo: FileRepo = {
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

/** Gespeicherte Objekte (Schlüssel = Objekt-Key); für Assertions. */
export const fakeObjects = objects;
export const fakeFileRows = rows;

export async function installFakeStorage(admin: RequestContext): Promise<void> {
	resetFakeStorage();
	const settings: Record<string, unknown> = {
		'core.storage.region': 'auto',
		'core.storage.bucket': 'test-bucket',
		'core.storage.accessKeyId': 'AK',
		'core.storage.secretAccessKey': 'SK'
	};
	for (const [k, v] of Object.entries(settings)) await setSetting(admin, k, v);
	setS3ClientFactoryForTests(() => s3);
	setFileRepoForTests(repo);
}

export function resetFakeStorage(): void {
	objects.clear();
	rows.clear();
}

export function uninstallFakeStorage(): void {
	setS3ClientFactoryForTests(undefined);
	setFileRepoForTests(undefined);
	resetFakeStorage();
}
