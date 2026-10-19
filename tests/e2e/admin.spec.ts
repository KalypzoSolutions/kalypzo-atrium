import { expect, test, type Page } from '@playwright/test';

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const run = Date.now().toString(36);

async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(email);
	await page.getByLabel('Passwort').fill(password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	if (password === ADMIN.password || email !== ADMIN.email) {
		await page.waitForURL(/\/dashboard/);
	}
}

test.describe.configure({ mode: 'serial' });

test('geschützte Seiten leiten auf den Login um', async ({ page }) => {
	await page.goto('/admin/users');
	await expect(page).toHaveURL(/\/login/);
});

test('falsches Passwort wird abgelehnt', async ({ page }) => {
	await login(page, ADMIN.email, 'falsches-passwort-123');
	await expect(page).toHaveURL(/\/login/);
	await expect(page.getByText(/E-Mail oder Passwort/)).toBeVisible();
});

test('Login und Logout', async ({ page }) => {
	await login(page);
	await expect(page).toHaveURL(/\/dashboard/);
	await page.getByRole('button', { name: 'Benutzermenü' }).click();
	await page.getByRole('menuitem', { name: 'Abmelden' }).click();
	await expect(page).toHaveURL(/\/login/);
	await page.goto('/dashboard');
	await expect(page).toHaveURL(/\/login/);
});

test('Benutzerverwaltung: anlegen, deaktivieren', async ({ page }) => {
	await login(page);
	await page.goto('/admin/users');
	await page.getByRole('button', { name: 'Benutzer anlegen' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(`E2E ${run}`);
	await dialog.getByLabel('E-Mail').fill(`e2e-${run}@example.test`);
	await dialog.getByLabel('Passwort').fill('e2e-user-password-1');
	await dialog.getByRole('button', { name: 'Anlegen' }).click();
	const row = page.getByRole('row', { name: new RegExp(`e2e-${run}@example.test`) });
	await expect(row).toBeVisible();
	await expect(row).toContainText('Aktiv');
	await row.getByRole('button', { name: /Deaktivieren/ }).click();
	await expect(
		page.getByRole('row', { name: new RegExp(`e2e-${run}@example.test`) })
	).toContainText('Deaktiviert');
});

test('Rollenverwaltung: Rolle anlegen', async ({ page }) => {
	await login(page);
	await page.goto('/admin/roles');
	await page.getByRole('button', { name: 'Rolle anlegen' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(`Rolle ${run}`);
	await dialog.getByRole('button', { name: 'Speichern' }).click();
	await expect(page.getByText(`Rolle ${run}`).first()).toBeVisible();
});

test('API-Key: erstellen, einmalig anzeigen, verwenden, widerrufen', async ({ page, request }) => {
	await login(page);
	await page.goto('/admin/api');
	await page
		.getByRole('button', { name: /API-Key erstellen|Neuer API-Key|Erstellen/ })
		.first()
		.click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(`Key ${run}`);
	await dialog.locator('input[name="scopes"][value="core.users.view"]').check();
	await dialog.getByRole('button', { name: 'Erstellen' }).click();
	const keyDialog = page.getByRole('dialog').filter({ hasText: 'erstellt' });
	await expect(keyDialog).toBeVisible();
	const key =
		(await keyDialog
			.locator('code, input[readonly]')
			.first()
			.innerText()
			.catch(() => '')) || (await keyDialog.locator('input[readonly]').first().inputValue());
	expect(key).toMatch(/^epk_/);

	const ok = await request.get('/api/v1/users', { headers: { authorization: `Bearer ${key}` } });
	expect(ok.status()).toBe(200);

	await keyDialog.getByRole('button', { name: /Fertig/ }).click();
	await page
		.getByRole('row', { name: new RegExp(`Key ${run}`) })
		.getByRole('button')
		.first()
		.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Widerrufen' }).click();
	await expect
		.poll(async () =>
			(await request.get('/api/v1/users', { headers: { authorization: `Bearer ${key}` } })).status()
		)
		.toBe(401);
});

test('Modulverwaltung und Audit-Log sind erreichbar', async ({ page }) => {
	await login(page);
	await page.goto('/admin/modules');
	await expect(page.getByRole('heading', { name: 'Module' })).toBeVisible();
	await page.goto('/admin/audit');
	await expect(page.getByText('core.auth.login').first()).toBeVisible();
});

test('Systemeinstellungen speichern', async ({ page }) => {
	await login(page);
	await page.goto('/admin/settings/general');
	const field = page.getByLabel('Systemname');
	await field.fill(`EP ${run}`);
	await page.getByRole('button', { name: 'Speichern' }).first().click();
	await page.reload();
	await expect(page.getByLabel('Systemname')).toHaveValue(`EP ${run}`);
});

test('OpenAPI-Spezifikation ist abrufbar', async ({ page }) => {
	await login(page);
	const res = await page.request.get('/api/v1/openapi.json');
	expect(res.status()).toBe(200);
	const spec = await res.json();
	expect(spec.openapi).toBe('3.1.0');
	expect(Object.keys(spec.paths)).toContain('/users');
});
