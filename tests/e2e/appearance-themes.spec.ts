import { expect, test, type Page } from '@playwright/test';

// Persönliche Themes: Vorschlag wählen, eigenes Theme mit Verlauf anlegen, SSR ohne Aufblitzen, Schnellwahl, Löschen.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const ORIGIN = 'http://localhost:4173';
/** Optional: Screenshots für die visuelle Prüfung ablegen (`THEME_SHOTS=<Ordner>`) */
const SHOTS = process.env.THEME_SHOTS;

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

const backdrop = (page: Page) =>
	page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage);

test('Themes: Vorschlag, eigenes Theme, Schnellwahl und Standard', async ({ page }) => {
	await login(page);
	// Ausgangslage: kein Theme
	await page.request.fetch('/profile/theme', {
		method: 'POST',
		headers: { origin: ORIGIN, 'content-type': 'application/json' },
		data: JSON.stringify({ activeTheme: '' })
	});

	await page.goto('/profile?tab=appearance');
	await expect(page.locator('html')).toHaveAttribute('data-app-theme', '');
	await page.getByRole('button', { name: 'Ozean', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'on');
	expect(await backdrop(page)).toContain('linear-gradient');

	// Neues eigenes Theme mit drittem Farbpunkt
	await page.getByRole('button', { name: 'Neues Theme' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill('E2E Theme');
	await dialog.getByRole('radio', { name: 'Radial' }).click();
	await expect(dialog.getByRole('slider', { name: /Farbpunkt/ })).toHaveCount(3);
	await dialog.getByRole('button', { name: 'Punkt', exact: true }).click();
	await expect(dialog.getByRole('slider', { name: /Farbpunkt/ })).toHaveCount(4);
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/theme-editor.png`, fullPage: true });
	await dialog.getByRole('button', { name: 'Speichern und verwenden' }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('button', { name: /^E2E Theme/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	// Nach dem Neuladen liefert schon der Server das Theme (kein Aufblitzen)
	const res = await page.request.get('/dashboard');
	const html = await res.text();
	expect(html).toContain('data-app-theme="on"');
	expect(html).toContain('radial-gradient(at center');
	await page.goto('/dashboard');
	expect(await backdrop(page)).toContain('radial-gradient');
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/theme-dashboard.png`, fullPage: true });

	// Dunkelmodus nutzt den dunklen Hintergrund
	await page.getByRole('button', { name: /Darstellung wählen/ }).click();
	await page.getByRole('menuitemradio', { name: 'Dunkel' }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	expect(await backdrop(page)).toContain('radial-gradient');
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/theme-dashboard-dark.png`, fullPage: true });

	// Schnellwahl in der Kopfzeile: zurück auf Standard
	await page.getByRole('button', { name: /Darstellung wählen/ }).click();
	await page.getByRole('menuitemradio', { name: 'Standard' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-app-theme', '');
	await page.getByRole('button', { name: /Darstellung wählen/ }).click();
	await page.getByRole('menuitemradio', { name: 'Hell' }).click();

	// Eigenes Theme löschen
	await page.goto('/profile?tab=appearance');
	await page.getByRole('button', { name: 'Aktionen für E2E Theme' }).click();
	await page.getByRole('menuitem', { name: 'Löschen' }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();
	await expect(page.getByRole('button', { name: /^E2E Theme/ })).toHaveCount(0);
});
