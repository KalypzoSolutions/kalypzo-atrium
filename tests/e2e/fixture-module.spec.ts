import { expect, test, type Page } from '@playwright/test';

// Kalypzo Atrium (Phase 4): Oberfläche eines Moduls aus dem Modulverzeichnis – interne Seite, vollflächige Seite,
// öffentliche Seite und Tailwind-Klasse, die nur im Modul steht. Läuft nur mit dem Fixture-Build
// (ATRIUM_MODULES_DIR=tests/fixtures/modules), sonst übersprungen.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const ORIGIN = 'http://localhost:4173';

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

async function api(page: Page, method: string, path: string) {
	const res = await page.request.fetch(`/api/v1${path}`, { method, headers: { origin: ORIGIN } });
	if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
	const text = await res.text();
	return text ? (JSON.parse(text) as { data: unknown }).data : null;
}

test('Modul aus dem Modulverzeichnis: Seiten, öffentliche Seite, Tailwind', async ({ page }) => {
	await login(page);
	const modules = (await api(page, 'GET', '/modules')) as {
		manifest: { id: string };
		enabled: boolean;
	}[];
	test.skip(!modules.some((m) => m.manifest.id === 'fx-board'), 'nur mit Fixture-Build');
	if (!modules.find((m) => m.manifest.id === 'fx-board')?.enabled) {
		await api(page, 'POST', '/modules/fx-board/enable');
	}

	await page.goto('/modules/fx-board');
	const card = page.getByTestId('fx-board-page');
	await expect(card).toBeVisible();
	await expect(card).toContainText('#2563eb');
	// min-h-[17.25rem] steht nur im Modul → nur vorhanden, wenn Tailwind das Modulverzeichnis liest
	await expect
		.poll(async () => card.evaluate((el) => getComputedStyle(el).minHeight))
		.toBe('276px');
	await expect(page.getByRole('link', { name: 'Pinnwand' })).toBeVisible();

	await page.goto('/modules/fx-board/abc');
	await expect(page.getByTestId('fx-board-note')).toContainText('Eintrag abc');

	await page.context().clearCookies();
	await page.goto('/p/fx-board/info');
	await expect(page.getByTestId('fx-board-public')).toContainText(
		'Hinweis aus einer eingebetteten Datei'
	);
});
