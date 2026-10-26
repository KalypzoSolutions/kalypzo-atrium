import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

// Bild-Zuschnitt beim Profilbild: Auswahl öffnet den Zuschnitt, „Übernehmen“ ersetzt die Datei im
// Formular durch den quadratischen Ausschnitt, „Abbrechen“ leert die Auswahl. Hochladen selbst braucht S3
// und ist hier nicht Gegenstand.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
/** Optional: Screenshots für die visuelle Prüfung ablegen (`CROP_SHOTS=<Ordner>`) */
const SHOTS = process.env.CROP_SHOTS;

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

/** Querformat 800 × 400: links rot, rechts blau */
async function landscapePng(): Promise<Buffer> {
	const half = (r: number, b: number) =>
		sharp({ create: { width: 400, height: 400, channels: 3, background: { r, g: 0, b } } })
			.png()
			.toBuffer();
	return sharp({ create: { width: 800, height: 400, channels: 3, background: '#000' } })
		.composite([
			{ input: await half(255, 0), left: 0, top: 0 },
			{ input: await half(0, 255), left: 400, top: 0 }
		])
		.png()
		.toBuffer();
}

const avatarDialog = (page: Page) => page.getByRole('dialog', { name: 'Profilbild ändern' });

async function openAvatarDialog(page: Page) {
	await page.goto('/profile');
	await page.getByRole('button', { name: 'Bild ändern' }).click();
	await expect(avatarDialog(page)).toBeVisible();
}

test('Profilbild: Ausschnitt wählen und übernehmen', async ({ page }) => {
	await login(page);
	await openAvatarDialog(page);
	await page
		.locator('#avatar-file')
		.setInputFiles({ name: 'urlaub.png', mimeType: 'image/png', buffer: await landscapePng() });

	const crop = page.getByRole('dialog', { name: 'Profilbild zuschneiden' });
	await expect(crop).toBeVisible();
	const stage = crop.getByRole('application');
	await expect(crop.getByRole('button', { name: 'Übernehmen' })).toBeEnabled();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/crop-dialog.png` });

	// Ganz nach rechts ziehen → linke (rote) Hälfte im Rahmen
	const box = (await stage.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	// Tastatur: zoomen und zurück
	await stage.focus();
	await page.keyboard.press('+');
	await expect(crop.getByText('110 %')).toBeVisible();
	await page.keyboard.press('-');
	await expect(crop.getByText('100 %')).toBeVisible();

	await crop.getByRole('button', { name: 'Übernehmen' }).click();
	await expect(crop).toBeHidden();
	await expect(avatarDialog(page)).toBeVisible();

	// Das Formularfeld enthält jetzt den Ausschnitt (400 × 400, rot), nicht das Original
	const result = await page.locator('#avatar-file').evaluate(async (el) => {
		const f = (el as HTMLInputElement).files?.[0];
		if (!f) return null;
		const bmp = await createImageBitmap(f);
		const c = new OffscreenCanvas(bmp.width, bmp.height);
		const ctx = c.getContext('2d')!;
		ctx.drawImage(bmp, 0, 0);
		const [r, , b] = ctx.getImageData(bmp.width / 2, bmp.height / 2, 1, 1).data;
		return { name: f.name, type: f.type, width: bmp.width, height: bmp.height, r, b };
	});
	expect(result).not.toBeNull();
	expect(result!.name).toMatch(/^urlaub\.(webp|jpg)$/);
	expect(result!.width).toBe(400);
	expect(result!.height).toBe(400);
	expect(result!.r).toBeGreaterThan(200);
	expect(result!.b).toBeLessThan(60);
	await expect(avatarDialog(page).getByRole('button', { name: 'Ausschnitt ändern' })).toBeVisible();
	await expect(avatarDialog(page).getByRole('button', { name: 'Speichern' })).toBeEnabled();
});

test('Profilbild: Zuschnitt abbrechen leert die Auswahl', async ({ page }) => {
	await login(page);
	await openAvatarDialog(page);
	await page
		.locator('#avatar-file')
		.setInputFiles({ name: 'bild.png', mimeType: 'image/png', buffer: await landscapePng() });
	const crop = page.getByRole('dialog', { name: 'Profilbild zuschneiden' });
	await expect(crop).toBeVisible();
	await crop.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(crop).toBeHidden();
	// Äußerer Dialog bleibt offen, nichts ausgewählt
	await expect(avatarDialog(page)).toBeVisible();
	await expect(avatarDialog(page).getByRole('button', { name: 'Speichern' })).toBeDisabled();
	expect(
		await page.locator('#avatar-file').evaluate((el) => (el as HTMLInputElement).files?.length ?? 0)
	).toBe(0);
});

test('Profilbild: über das Bild hinaus herauszoomen, Ränder in der Hintergrundfarbe', async ({
	page
}) => {
	await login(page);
	await openAvatarDialog(page);
	await page
		.locator('#avatar-file')
		.setInputFiles({ name: 'weit.png', mimeType: 'image/png', buffer: await landscapePng() });
	const crop = page.getByRole('dialog', { name: 'Profilbild zuschneiden' });
	await expect(crop.getByRole('button', { name: 'Übernehmen' })).toBeEnabled();

	// Querformat 2:1 im runden (quadratischen) Rahmen: kleinster Zoom 25 %
	await crop.getByRole('application').focus();
	for (let i = 0; i < 20; i++) await page.keyboard.press('-');
	await expect(crop.getByText('25 %')).toBeVisible();
	await expect(crop.getByRole('button', { name: 'Verkleinern' })).toBeDisabled();

	await crop.getByRole('button', { name: 'Hintergrundfarbe' }).click();
	await page.getByRole('button', { name: /^Farbe #000000$/i }).click();
	await page.keyboard.press('Escape'); // schließt nur die Farbauswahl
	await expect(crop).toBeVisible();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/crop-zoomed-out.png` });
	await crop.getByRole('button', { name: 'Übernehmen' }).click();
	await expect(crop).toBeHidden();

	const px = await page.locator('#avatar-file').evaluate(async (el) => {
		const f = (el as HTMLInputElement).files![0]!;
		const bmp = await createImageBitmap(f);
		const c = new OffscreenCanvas(bmp.width, bmp.height);
		const ctx = c.getContext('2d')!;
		ctx.drawImage(bmp, 0, 0);
		const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
		return { width: bmp.width, corner: at(5, 5), red: at(180, 256), blue: at(330, 256) };
	});
	// Rahmen = 4000 Originalpixel → auf 512 begrenzt; Bild 256 × 128 mittig
	expect(px.width).toBe(512);
	expect(Math.max(...px.corner.slice(0, 3))).toBeLessThan(30);
	expect(px.red[0]).toBeGreaterThan(200);
	expect(px.blue[2]).toBeGreaterThan(200);
});
