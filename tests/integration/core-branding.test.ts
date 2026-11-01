/**
 * Logo als Favicon/App-Icon: Upload wird neu kodiert (PNG ≤ 1024 px, ohne EXIF/GPS), Icons entstehen
 * daraus in fester Größe, ohne Logo greifen die neutralen Icons. Rechte: `core.settings.manage`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { useTestDatabase } from '../helpers/db';
import { fakeObjects, installFakeStorage, uninstallFakeStorage } from '../helpers/fake-storage';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import {
	BRAND_ICONS,
	brandIcon,
	brandLogo,
	brandVersion,
	brandingState,
	logoUrl,
	removeLogo,
	setLogo
} from '$lib/server/core/branding';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import { setSetting } from '$lib/server/core/settings/service';
import type { RequestContext } from '$lib/sdk/types';

const PW = 'correct-horse-battery';
let admin: RequestContext;
let close: () => Promise<void>;

/** Breites JPEG mit EXIF (Kamera-Angabe) */
async function wideJpeg(): Promise<Uint8Array> {
	return new Uint8Array(
		await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#1d6a4f' } })
			.jpeg()
			.withExif({ IFD0: { Make: 'GeheimKamera' } })
			.toBuffer()
	);
}

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

describe('Logo und App-Icons', () => {
	it('ohne Logo: neutrale Icons (null), unbekannte Namen undefined', async () => {
		const state = await brandingState();
		expect(state.logoId).toBeNull();
		expect(logoUrl(state)).toBeNull();
		expect(brandVersion(state)).toBe('n');
		expect(await brandIcon('icon-192.png', state)).toBeNull();
		expect(await brandIcon('../secret.png', state)).toBeUndefined();
		expect(await brandLogo(state)).toBeNull();
	});

	it('Upload: neu kodiert als PNG ≤ 1024 px ohne Metadaten', async () => {
		const id = await setLogo(admin, { data: await wideJpeg(), contentType: 'image/jpeg' });
		const stored = [...fakeObjects.values()].at(-1)!;
		expect(stored.contentType).toBe('image/png');
		const meta = await sharp(stored.body).metadata();
		expect(meta.format).toBe('png');
		expect(meta.width).toBe(1024);
		expect(Buffer.from(stored.body).toString('latin1')).not.toContain('GeheimKamera');
		const state = await brandingState();
		expect(state.logoId).toBe(id);
		expect(logoUrl(state)).toMatch(/^\/branding\/logo\.png\?v=/);
	});

	it('Icons in fester Größe; Apple/maskierbar mit Hintergrund, Favicon transparent', async () => {
		await setSetting(admin, 'core.design.iconBackground', '#ff0000');
		const state = await brandingState();
		for (const [name, spec] of Object.entries(BRAND_ICONS)) {
			const bytes = await brandIcon(name, state);
			expect(bytes, name).toBeInstanceOf(Uint8Array);
			const meta = await sharp(bytes!).metadata();
			expect([meta.width, meta.height], name).toEqual([spec.size, spec.size]);
		}
		// Ecke oben links: Logo ist breit (2:1) → oben Rand
		const corner = async (name: string) =>
			(
				await sharp((await brandIcon(name, state))!)
					.ensureAlpha()
					.raw()
					.toBuffer()
			).subarray(0, 4);
		expect([...(await corner('maskable-512.png'))]).toEqual([255, 0, 0, 255]);
		expect((await corner('favicon-32.png'))[3]).toBe(0);
	});

	it('ungültige Dateien und fehlendes Recht', async () => {
		await expect(
			setLogo(admin, { data: new TextEncoder().encode('<svg/>'), contentType: 'image/svg+xml' })
		).rejects.toMatchObject({ status: 400 });
		await expect(
			setLogo(admin, { data: new TextEncoder().encode('kein bild'), contentType: 'image/png' })
		).rejects.toMatchObject({ status: 400 });
		const userId = await createUser(admin, {
			name: 'Ohne Recht',
			email: 'ohne@example.test',
			password: PW
		});
		const user = (await contextForUser(userId))!.ctx;
		await expect(
			setLogo(user, { data: await wideJpeg(), contentType: 'image/jpeg' })
		).rejects.toMatchObject({ status: 403 });
		await expect(removeLogo(user)).rejects.toMatchObject({ status: 403 });
	});

	it('Entfernen: zurück zu den neutralen Icons', async () => {
		await removeLogo(admin);
		const state = await brandingState();
		expect(state.logoId).toBeNull();
		expect(await brandIcon('icon-512.png', state)).toBeNull();
	});
});
