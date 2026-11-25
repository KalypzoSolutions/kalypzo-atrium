import { expect, test } from '@playwright/test';

test('Marktplatz bleibt offline bedienbar', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill('admin@example.test');
	await page.getByLabel('Passwort').fill('e2e-admin-password-1');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/dashboard/);
	await page.goto('/admin/modules/marketplace');
	await expect(page.getByText('Marktplatz nicht erreichbar')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Zur Installation per Link' })).toHaveAttribute(
		'href',
		'/admin/modules/install'
	);
});

test('Fixture: Suche, Filter und Installationslink', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill('admin@example.test');
	await page.getByLabel('Passwort').fill('e2e-admin-password-1');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/dashboard/);
	await page.goto('/admin/modules/marketplace');
	await page.getByText('Marktplatz-Einstellungen').click();
	const originalUrl = await page.getByLabel('Marktplatz-URL').inputValue();
	await page.getByLabel('Marktplatz-URL').fill('https://fixture.example.test/marketplace.json');
	await page.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText('Beispielpaket')).toBeVisible();
	await page.getByLabel('Suche').fill('gruppen');
	await page.getByRole('button', { name: 'Organisation', exact: true }).click();
	await page.getByLabel('Nur offizielle').check();
	await expect(page.getByText('Beispielpaket')).toBeVisible();
	await page.getByRole('button', { name: 'Einzelne Module' }).click();
	const link = page.getByRole('link', { name: 'Installieren', exact: true });
	await expect(link).toHaveAttribute('href', /select=fixture-module/);
	await page.getByLabel('Suche').fill('kein-treffer');
	await expect(page.getByText('Keine passenden Einträge gefunden.')).toBeVisible();
	await page.getByText('Marktplatz-Einstellungen').click();
	await page.getByLabel('Marktplatz-URL').fill(originalUrl);
	await page.getByRole('button', { name: 'Speichern' }).click();
});
