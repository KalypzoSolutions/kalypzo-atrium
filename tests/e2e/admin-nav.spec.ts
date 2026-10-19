import { expect, test, type Page } from '@playwright/test';

// Verwaltung unter /admin: Übersicht mit Abschnitten und Suche, Befehlspalette (Strg+K),
// Weiterleitungen alter URLs, /admin/settings → erster erlaubter Reiter.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };

async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(email);
	await page.getByLabel('Passwort').fill(password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

function main(page: Page) {
	return page.getByRole('main').or(page.locator('main')).first();
}

test.describe.configure({ mode: 'serial' });

test('Übersicht zeigt alle Abschnitte', async ({ page }) => {
	await login(page);
	await page.goto('/admin');
	await expect(page.getByRole('heading', { name: 'Verwaltung' })).toBeVisible();
	const content = main(page);
	for (const section of [
		'Personen & Rechte',
		'Einstellungen',
		'Module',
		'Schnittstellen',
		'Protokoll & Wartung'
	]) {
		await expect(content.getByText(section, { exact: true }).first()).toBeVisible();
	}
	await expect(content.getByRole('link', { name: /Benutzer/ }).first()).toBeVisible();
	await expect(content.getByRole('link', { name: /E-Mail-Versand/ }).first()).toBeVisible();
});

test('Seitenleiste: Administration mit Übersicht', async ({ page }) => {
	await login(page);
	const nav = page.getByRole('navigation', { name: 'Hauptnavigation' }).first();
	const adminToggle = nav.getByRole('button', { name: 'Administration' });
	if ((await adminToggle.getAttribute('aria-expanded')) !== 'true') await adminToggle.click();
	await nav.getByRole('link', { name: 'Übersicht' }).click();
	await expect(page).toHaveURL(/\/admin$/);
});

test('Suche „smtp“ findet E-Mail-Versand', async ({ page }) => {
	await login(page);
	await page.goto('/admin');
	await page.getByRole('searchbox', { name: 'Einstellung suchen' }).fill('smtp');
	const hit = main(page)
		.getByRole('link', { name: /E-Mail-Versand/ })
		.first();
	await expect(hit).toBeVisible();
	await hit.click();
	await expect(page).toHaveURL(/\/admin\/settings\/mail$/);
});

test('Suche ohne Treffer zeigt Hinweis', async ({ page }) => {
	await login(page);
	await page.goto('/admin?q=xyzunbekannt');
	await expect(page.getByText('Nichts gefunden').first()).toBeVisible();
});

test('Strg+K öffnet die Befehlspalette, „logo“ + Enter → Design', async ({ page }) => {
	await login(page);
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog');
	await expect(palette).toBeVisible();
	const input = palette.getByRole('combobox', { name: 'Seite oder Einstellung suchen' });
	await expect(input).toBeFocused();
	await input.fill('logo');
	await expect(palette.getByRole('option').first()).toContainText('Design');
	await input.press('Enter');
	await expect(page).toHaveURL(/\/admin\/settings\/design$/);
	await expect(palette).toBeHidden();
});

test('Topbar-Button „Suchen“ öffnet die Befehlspalette', async ({ page }) => {
	await login(page);
	await page.getByRole('button', { name: 'Suchen (Strg+K)' }).click();
	const palette = page.getByRole('dialog');
	await expect(palette).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(palette).toBeHidden();
});

test('alte URLs landen auf den neuen', async ({ page }) => {
	await login(page);
	const cases: [string, RegExp][] = [
		['/settings', /\/admin\/settings\/general$/],
		['/ai', /\/admin\/settings\/ai$/],
		['/api-keys', /\/admin\/api$/],
		['/api-docs', /\/admin\/api\/docs$/],
		['/users', /\/admin\/users$/],
		['/permissions', /\/admin\/roles\/permissions$/],
		['/modules', /\/admin\/modules$/],
		['/system/reset', /\/admin\/reset$/]
	];
	for (const [from, to] of cases) {
		await page.goto(from);
		await expect(page, from).toHaveURL(to);
	}
});

test('alte URL antwortet mit 308 und behält die Query', async ({ page }) => {
	await login(page);
	const res = await page.request.get('/audit?action=core.auth.login', { maxRedirects: 0 });
	expect(res.status()).toBe(308);
	expect(res.headers()['location']).toBe('/admin/audit?action=core.auth.login');
});

test('/admin/settings leitet auf den ersten erlaubten Reiter', async ({ page }) => {
	await login(page);
	await page.goto('/admin/settings');
	await expect(page).toHaveURL(/\/admin\/settings\/general$/);
	const tabs = page.getByRole('navigation', { name: 'Einstellungsbereiche' });
	for (const label of ['Allgemein', 'Design', 'E-Mail-Versand', 'E-Mail-Layout', 'Module']) {
		await expect(tabs.getByRole('link', { name: label, exact: true })).toBeVisible();
	}
	await expect(tabs.getByRole('link', { name: 'Allgemein', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
});
