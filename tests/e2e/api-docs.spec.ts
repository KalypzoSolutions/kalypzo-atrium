import { expect, test, type Page } from '@playwright/test';

// API-Übersicht (/api-docs): Nav-Eintrag, Katalog, Suche, Sheet mit Tabs, Konsole (GET sendet,
// schreibende Methoden fragen erst nach), Zugriff ohne `core.api.view` wird verweigert.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const ORIGIN = 'http://localhost:4173';
const run = Date.now().toString(36);
const PLAIN = {
	name: `API-Docs ${run}`,
	email: `api-docs-${run}@example.test`,
	password: 'e2e-plain-password-1'
};

async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(email);
	await page.getByLabel('Passwort').fill(password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

function mainNav(page: Page) {
	return page.getByRole('navigation', { name: 'Hauptnavigation' }).first();
}

function searchField(page: Page) {
	return page
		.getByRole('searchbox')
		.or(page.getByPlaceholder(/Such/i))
		.or(page.getByLabel(/Such/i))
		.first();
}

/** Zeilen der Endpunkt-Tabellen (Pfad steht als Text `/api/v1/...` in der Zeile) */
function endpointRows(page: Page) {
	return page.getByRole('row').filter({ hasText: '/api/v1/' });
}

function endpointRow(page: Page, method: string, path: string) {
	return page
		.getByRole('row')
		.filter({ has: page.getByText(path, { exact: true }) })
		.filter({ hasText: method });
}

async function openEndpoint(page: Page, method: string, path: string) {
	await page.goto('/api-docs');
	await searchField(page).fill(path.replace('/api/v1', ''));
	const row = endpointRow(page, method, path).first();
	await expect(row).toBeVisible();
	await row.click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByText(path, { exact: true }).first()).toBeVisible();
	return sheet;
}

test.describe.configure({ mode: 'serial' });

test('Admin: Nav-Eintrag, Seite und Suche', async ({ page }) => {
	await login(page);

	// Gruppe „Administration“ aufklappen (auf dem Dashboard eingeklappt)
	const nav = mainNav(page);
	const adminToggle = nav.getByRole('button', { name: 'Administration' });
	if ((await adminToggle.getAttribute('aria-expanded')) !== 'true') await adminToggle.click();
	const link = nav.getByRole('link', { name: 'API-Übersicht' });
	await expect(link).toBeVisible();

	// Reihenfolge: direkt nach „API-Keys“
	const labels = (await nav.getByRole('link').allInnerTexts()).map((t) => t.trim());
	const keysIndex = labels.indexOf('API-Keys');
	expect(keysIndex).toBeGreaterThanOrEqual(0);
	expect(labels[keysIndex + 1]).toBe('API-Übersicht');

	await link.click();
	await expect(page).toHaveURL(/\/api-docs/);
	await expect(page.getByRole('heading', { name: 'API-Übersicht' })).toBeVisible();
	await expect.poll(() => endpointRows(page).count()).toBeGreaterThan(20);

	await searchField(page).fill('health');
	const health = endpointRow(page, 'GET', '/api/v1/health');
	await expect(health.first()).toBeVisible();
	await expect(endpointRow(page, 'GET', '/api/v1/users')).toHaveCount(0);
	await expect.poll(() => endpointRows(page).count()).toBeLessThan(5);
});

test('GET /api/v1/me ausprobieren und Fehler ansehen', async ({ page }) => {
	await login(page);
	const sheet = await openEndpoint(page, 'GET', '/api/v1/me');

	await sheet.getByRole('tab', { name: 'Ausprobieren' }).click();
	const response = page.waitForResponse(
		(r) => new URL(r.url()).pathname === '/api/v1/me' && r.request().method() === 'GET'
	);
	await sheet.getByRole('button', { name: 'Senden' }).click();
	expect((await response).status()).toBe(200);
	await expect(sheet.getByRole('tabpanel').getByText(/\b200\b/).first()).toBeVisible();

	await sheet.getByRole('tab', { name: 'Fehler' }).click();
	await expect(sheet.getByRole('tabpanel').getByText(/\b401\b/).first()).toBeVisible();
	await expect(sheet.getByRole('tabpanel').getByText('unauthenticated').first()).toBeVisible();
});

test('POST /api/v1/users fragt vor dem Senden nach, Abbrechen sendet nichts', async ({ page }) => {
	await login(page);
	const sheet = await openEndpoint(page, 'POST', '/api/v1/users');

	const posts: string[] = [];
	page.on('request', (r) => {
		if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/v1/users') posts.push(r.url());
	});

	await sheet.getByRole('tab', { name: 'Ausprobieren' }).click();
	await sheet.getByRole('button', { name: 'Senden' }).click();
	const confirm = page.getByRole('alertdialog');
	await expect(confirm).toBeVisible();
	await confirm.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(confirm).toBeHidden();

	// Kein Ergebnis-Status, keine Anfrage
	await expect(sheet.getByRole('tabpanel').getByText(/\b(201|422)\b/)).toHaveCount(0);
	expect(posts).toHaveLength(0);
});

test('ohne core.api.view: kein Nav-Eintrag, Seite verweigert', async ({ page, browser }) => {
	await login(page);
	const res = await page.request.post('/api/v1/users', {
		headers: { origin: ORIGIN, 'content-type': 'application/json' },
		data: JSON.stringify({ ...PLAIN, roleIds: [] })
	});
	expect(res.status()).toBe(201);

	const ctx = await browser.newContext({ baseURL: ORIGIN });
	const plain = await ctx.newPage();
	try {
		await login(plain, PLAIN.email, PLAIN.password);
		await expect(plain.locator('a[href="/api-docs"]')).toHaveCount(0);

		const nav = await plain.request.get('/api-docs');
		expect(nav.status()).toBe(403);

		await plain.goto('/api-docs');
		await expect(plain.getByText('403').first()).toBeVisible();
		await expect(plain.getByRole('heading', { name: 'API-Übersicht' })).toHaveCount(0);
	} finally {
		await ctx.close();
	}
});
