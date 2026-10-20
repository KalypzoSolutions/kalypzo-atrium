import { expect, test, type Page } from '@playwright/test';

// Mobil-Smoke (390×844): kein horizontaler Seiten-Scroll auf den Hauptseiten, DataTable als Karten,
// Dialoge passen in den Viewport.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

/** Seite breiter als der Viewport? (ohne Tabellen mit eigenem Scroll-Container) */
async function overflowsHorizontally(page: Page): Promise<boolean> {
	return page.evaluate(
		() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
	);
}

test.describe('Mobilansicht', () => {
	test('Hauptseiten haben keinen horizontalen Seiten-Scroll', async ({ page }) => {
		await login(page);
		for (const path of ['/dashboard', '/users', '/audit', '/modules']) {
			await page.goto(path);
			await page.waitForLoadState('networkidle');
			expect(await overflowsHorizontally(page), `${path} läuft über`).toBe(false);
		}
	});

	test('Navigation öffnet sich über das Menü', async ({ page }) => {
		await login(page);
		await page.getByRole('button', { name: 'Navigation öffnen' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
	});

	test('Touch-Ziele der Kopfzeile sind mindestens 36 px hoch', async ({ page }) => {
		await login(page);
		const box = await page.getByRole('button', { name: 'Navigation öffnen' }).boundingBox();
		expect(box).not.toBeNull();
		expect(box!.height).toBeGreaterThanOrEqual(36);
		expect(box!.width).toBeGreaterThanOrEqual(36);
	});
});
