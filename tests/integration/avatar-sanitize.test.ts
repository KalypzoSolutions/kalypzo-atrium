/**
 * #19 (Avatar-Teil): Profilbilder werden über `core.images` neu kodiert (WebP ≤ 512 px, ohne EXIF/GPS);
 * der Core-Job `core.avatars-reprocess` bereinigt vorhandene Bilder idempotent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { useTestDatabase } from '../helpers/db';
import { fakeObjects, installFakeStorage, uninstallFakeStorage } from '../helpers/fake-storage';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser, systemContext } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import {
	readAvatar,
	reprocessLegacyAvatars,
	setOwnAvatar,
	setUserAvatar
} from '$lib/server/core/auth/profile';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import * as storage from '$lib/server/core/storage';
import type { RequestContext } from '$lib/sdk/types';

const PW = 'correct-horse-battery';
let admin: RequestContext;
let close: () => Promise<void>;

/** JPEG 1200×800 mit EXIF (Kamera, Kommentar) und GPS-Position */
async function jpegWithGps(): Promise<Uint8Array> {
	return new Uint8Array(
		await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#2266aa' } })
			.jpeg()
			.withExif({
				IFD0: { Make: 'GeheimKamera', Copyright: 'GeheimOrt Sommerlager' },
				IFD3: {
					GPSLatitudeRef: 'N',
					GPSLatitude: '53/1 5/1 0/1',
					GPSLongitudeRef: 'E',
					GPSLongitude: '8/1 48/1 0/1'
				}
			})
			.toBuffer()
	);
}

const imageOf = async (id: string) =>
	(await getDb().select().from(schema.user).where(eq(schema.user.id, id)))[0]!.image;

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = (await contextForUser(u!.id))!.ctx;
	await installFakeStorage(admin);
});
afterAll(async () => {
	uninstallFakeStorage();
	await close();
});

describe('Profilbild-Bereinigung beim Hochladen', () => {
	it('Testbild trägt wirklich EXIF/GPS', async () => {
		const meta = await sharp(await jpegWithGps()).metadata();
		expect(meta.exif).toBeTruthy();
		expect(Buffer.from(meta.exif!).toString('latin1')).toContain('GeheimKamera');
	});

	it('eigenes Bild: gespeichert als WebP ≤ 512 px ohne EXIF/GPS', async () => {
		const id = await createUser(admin, { name: 'Ava', email: 'ava@example.test', password: PW });
		const ctx = (await contextForUser(id))!.ctx;
		await setOwnAvatar(ctx, { data: await jpegWithGps(), contentType: 'image/jpeg' });
		const stored = [...fakeObjects.values()].at(-1)!;
		expect(stored.contentType).toBe('image/webp');
		const meta = await sharp(stored.body).metadata();
		expect(meta.format).toBe('webp');
		expect(Math.max(meta.width!, meta.height!)).toBe(512);
		expect(meta.exif).toBeUndefined();
		const raw = Buffer.from(stored.body).toString('latin1');
		expect(raw).not.toContain('GeheimKamera');
		expect(raw).not.toContain('GeheimOrt');
		expect((await readAvatar(id))?.contentType).toBe('image/webp');
	});

	it('Verwaltung (setUserAvatar) bereinigt ebenso', async () => {
		const id = await createUser(admin, { name: 'Bea', email: 'bea@example.test', password: PW });
		await setUserAvatar(admin, id, { data: await jpegWithGps(), contentType: 'image/jpeg' });
		const read = await readAvatar(id);
		expect((await sharp(read!.data).metadata()).exif).toBeUndefined();
	});

	it('angegebener Typ muss zum erkannten Format passen (sonst 400)', async () => {
		const id = await createUser(admin, { name: 'Cem', email: 'cem@example.test', password: PW });
		const ctx = (await contextForUser(id))!.ctx;
		await expect(
			setOwnAvatar(ctx, { data: await jpegWithGps(), contentType: 'image/png' })
		).rejects.toMatchObject({ code: 'bad_request' });
		// gültige Signatur, aber kaputter Inhalt
		const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
		await expect(
			setOwnAvatar(ctx, { data: broken, contentType: 'image/jpeg' })
		).rejects.toMatchObject({ code: 'bad_request' });
		expect(await imageOf(id)).toBeNull();
	});
});

describe('Bestands-Job core.avatars-reprocess', () => {
	it('verarbeitet alte Bilder neu, entfernt unlesbare, ist idempotent', async () => {
		const sys = systemContext('avatar');
		const legacy = await createUser(admin, {
			name: 'Alt',
			email: 'alt@example.test',
			password: PW
		});
		const broken = await createUser(admin, {
			name: 'Kaputt',
			email: 'kaputt@example.test',
			password: PW
		});
		// Altbestand wie vor #19: Original unverändert gespeichert, `user.image` ohne Marker
		await storage.upload(sys, {
			module: 'core',
			path: `avatars/${legacy}`,
			file: await jpegWithGps(),
			contentType: 'image/jpeg',
			name: 'avatar'
		});
		await storage.upload(sys, {
			module: 'core',
			path: `avatars/${broken}`,
			file: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]),
			contentType: 'image/jpeg',
			name: 'avatar'
		});
		for (const id of [legacy, broken]) {
			await getDb()
				.update(schema.user)
				.set({ image: `/avatar/${id}?v=1` })
				.where(eq(schema.user.id, id));
		}

		const first = await reprocessLegacyAvatars(admin);
		expect(first).toMatchObject({ processed: 1, removed: 1 });
		expect(await imageOf(legacy)).toMatch(/&n=1$/);
		expect(await imageOf(broken)).toBeNull();
		const read = await readAvatar(legacy);
		expect(read?.contentType).toBe('image/webp');
		expect((await sharp(read!.data).metadata()).exif).toBeUndefined();
		expect(Buffer.from(read!.data).toString('latin1')).not.toContain('GeheimOrt');

		const second = await reprocessLegacyAvatars(admin);
		expect(second).toEqual({ processed: 0, removed: 0, skipped: 0 });
	});
});
