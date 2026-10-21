import { GetObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsStore } from './_helpers';

vi.mock('$lib/server/core/settings/service', () => ({
	getSettings: async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, settingsStore[k]])),
	getSetting: async (k: string) => settingsStore[k]
}));
vi.mock('$lib/server/core/audit/service', () => ({ auditFromContext: async () => undefined }));

import * as storage from '$lib/server/core/storage';
import type { FileRow } from '$lib/server/core/storage';
import { loadLogo } from '$lib/server/core/pdf';
import { CORE_SETTINGS } from '$lib/server/core/settings/catalog';

// #67 (01a-08): `core.design.logoFileId` darf nur Logos aus `core/branding/` in PDFs einbetten.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const rows = new Map<string, FileRow>();
const objects = new Map<string, Uint8Array>();

function addFile(id: string, moduleId: string, path: string) {
	const objectKey = `${moduleId}/${id}`;
	rows.set(id, {
		id,
		moduleId,
		path,
		objectKey,
		name: 'bild.png',
		size: PNG.byteLength,
		contentType: 'image/png',
		checksum: null,
		status: 'ready',
		createdBy: null,
		createdAt: new Date()
	} as FileRow);
	objects.set(objectKey, PNG);
}

beforeEach(() => {
	rows.clear();
	objects.clear();
	Object.assign(settingsStore, {
		'core.storage.endpoint': '',
		'core.storage.region': 'auto',
		'core.storage.bucket': 'b',
		'core.storage.accessKeyId': 'AK',
		'core.storage.secretAccessKey': 'SK',
		'core.storage.forcePathStyle': false
	});
	storage.setS3ClientFactoryForTests(() => ({
		bucket: 'b',
		async send(cmd) {
			if (cmd instanceof GetObjectCommand) {
				const body = objects.get(cmd.input.Key!);
				if (!body) throw Object.assign(new Error('x'), { name: 'NoSuchKey' });
				return { Body: { transformToByteArray: async () => body } };
			}
			throw new Error('unerwartet');
		},
		async presign() {
			return '';
		}
	}));
	storage.setFileRepoForTests({
		findById: async (id: string) => rows.get(id)
	} as unknown as storage.FileRepo);
});

describe('PDF-Logo', () => {
	const own = '11111111-1111-4111-8111-111111111111';
	const foreign = '22222222-2222-4222-8222-222222222222';
	const coreOther = '33333333-3333-4333-8333-333333333333';

	it('lädt das Logo aus core/branding/', async () => {
		addFile(own, 'core', 'branding/logo-1');
		expect(await loadLogo(own)).toMatch(/^data:image\/png;base64,/);
	});

	it('fremde Datei-ID (anderes Modul) → kein Logo', async () => {
		addFile(foreign, 'galleries', 'g1/images/abc');
		expect(await loadLogo(foreign)).toBeNull();
	});

	it('Core-Datei außerhalb von branding/ → kein Logo', async () => {
		addFile(coreOther, 'core', 'avatars/u1');
		expect(await loadLogo(coreOther)).toBeNull();
	});

	it('keine UUID → kein Logo, ohne Speicherzugriff', async () => {
		expect(await loadLogo('../x')).toBeNull();
		expect(await loadLogo('')).toBeNull();
	});

	it('Einstellung akzeptiert nur leer oder UUID', () => {
		const def = CORE_SETTINGS.find((d) => d.key === 'core.design.logoFileId')!;
		expect(def.schema.safeParse('').success).toBe(true);
		expect(def.schema.safeParse(own).success).toBe(true);
		expect(def.schema.safeParse('irgendwas').success).toBe(false);
	});
});
