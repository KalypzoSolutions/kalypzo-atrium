import { expect, test, type Page } from '@playwright/test';

/** Benutzer-Detailseite: Kennzahlen, Einmal-Link, Passwort setzen mit Pflicht, „Als Person handeln“ mit Banner. */
const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const run = Date.now().toString(36);
const email = `detail-${run}@example.test`;

async function login(page: Page, mail = ADMIN.email, password = ADMIN.password) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(mail);
	await page.getByLabel('Passwort').fill(password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe.configure({ mode: 'serial' });

test('Detailseite, Link, Passwort mit Pflicht, Als Person handeln', async ({ page, browser }) => {
	await login(page);
	await page.goto('/admin/users');
	await page.getByRole('button', { name: 'Benutzer anlegen' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(`Detail ${run}`);
	await dialog.getByLabel('E-Mail').fill(email);
	await dialog.getByLabel('Passwort').fill('detail-user-password-1');
	await dialog.getByRole('button', { name: 'Anlegen' }).click();
	await page.getByRole('link', { name: `Detail ${run}` }).click();
	await expect(page.getByRole('heading', { name: `Detail ${run}` })).toBeVisible();
	await expect(page.getByText('Letzte Anmeldung')).toBeVisible();

	// Einmal-Link erzeugen
	await page.getByRole('tab', { name: 'Sicherheit' }).click();
	await page.getByRole('button', { name: 'Link erzeugen' }).click();
	const link = page.getByRole('textbox', { name: 'Einmal-Link zum Zurücksetzen' });
	await expect(link).toHaveValue(/\/reset-password\?token=/);

	// Passwort setzen (zufällig, Pflicht zur Änderung)
	await page.getByRole('button', { name: 'Passwort setzen' }).first().click();
	await page.getByRole('dialog').getByRole('button', { name: 'Passwort setzen' }).click();
	const generated = page.getByRole('textbox', { name: 'Neues Passwort' });
	await expect(generated).toHaveValue(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
	const password = await generated.inputValue();
	await page.getByRole('button', { name: 'Schließen' }).last().click();

	// Die Person muss nach der Anmeldung ihr Passwort ändern
	const other = await browser.newPage();
	await login(other, email, password);
	await expect(other).toHaveURL(/\/profile\?tab=security&mustChange=1/);
	await other.goto('/dashboard');
	await expect(other).toHaveURL(/mustChange=1/);
	await other.close();

	// Als Person handeln
	await page.getByRole('button', { name: 'Als Person handeln' }).click();
	await page.locator('#imp-reason').fill('E2E: Ablauf prüfen');
	await page.locator('#imp-pw').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Starten' }).click();
	await expect(page.getByText(`Du handelst als Detail ${run}`)).toBeVisible();
	await page.getByRole('button', { name: 'Beenden' }).click();
	await expect(page).toHaveURL(/\/admin\/users\/[0-9a-f-]{36}/);
	await expect(page.getByText(`Du handelst als`)).toHaveCount(0);
});
