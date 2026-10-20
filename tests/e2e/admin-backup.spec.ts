import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Datensicherung unter /admin/backup: erreichbar über Befehlspalette und Seitenleiste, Export mit Passwort
// (Download abfangen), danach eine Rolle anlegen, Import-Assistent mit der Datei (Wiederherstellen, Bereich Rollen)
// → Rolle ist wieder weg. Im E2E gibt es kein S3 – Sicherung daher ohne Dateien.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const ORIGIN = 'http://localhost:4173';
const BACKUP_PW = 'E2E-Sicherung-Passwort-2026';
const run = Date.now().toString(36);

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

async function api<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
	const res = await page.request.fetch(`/api/v1${path}`, {
		method,
		headers: {
			origin: ORIGIN,
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		data: body === undefined ? undefined : JSON.stringify(body)
	});
	if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
	const text = await res.text();
	return (text ? (JSON.parse(text) as { data: T }).data : null) as T;
}

const roleNames = async (page: Page) =>
	(await api<{ name: string }[]>(page, 'GET', '/roles')).map((r) => r.name);

test.describe.configure({ mode: 'serial' });

let backupFile = '';

test('Seite über Befehlspalette und Seitenleiste erreichbar', async ({ page }) => {
	await login(page);
	await page.keyboard.press('Control+k');
	const palette = page.getByRole('dialog');
	const input = palette.getByRole('combobox', { name: 'Seite oder Einstellung suchen' });
	await input.fill('Sicherung');
	await expect(palette.getByRole('option').first()).toContainText('Datensicherung');
	await input.press('Enter');
	await expect(page).toHaveURL(/\/admin\/backup$/);
	await expect(page.getByRole('heading', { name: 'Datensicherung' })).toBeVisible();

	await page.goto('/dashboard');
	const nav = page.getByRole('navigation', { name: 'Hauptnavigation' }).first();
	const adminToggle = nav.getByRole('button', { name: 'Administration' });
	if ((await adminToggle.getAttribute('aria-expanded')) !== 'true') await adminToggle.click();
	await nav.getByRole('link', { name: 'Datensicherung' }).click();
	await expect(page).toHaveURL(/\/admin\/backup$/);
});

test('Export: nur Rollen, ohne Dateien, mit Passwort → Download', async ({ page }, info) => {
	await login(page);
	await page.goto('/admin/backup');
	// Auswahl: nur „Rollen“
	const all = page.locator('#scope-all');
	if ((await all.getAttribute('data-state')) !== 'unchecked') await all.click();
	if ((await all.getAttribute('data-state')) !== 'unchecked') await all.click();
	await page.locator('#scope-core-roles').click();
	await expect(page.locator('#scope-core-roles')).toHaveAttribute('data-state', 'checked');
	const files = page.locator('#export-files');
	if ((await files.getAttribute('data-state')) === 'checked') await files.click();

	await page.locator('#export-backup-password').fill(BACKUP_PW);
	await page.locator('#export-backup-password2').fill(BACKUP_PW);
	await page.screenshot({ path: 'test-results/backup-export.png', fullPage: true });
	await page.getByRole('button', { name: 'Sicherung erstellen' }).click();

	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('Sicherung bestätigen')).toBeVisible();
	await dialog.locator('#export-password').fill(ADMIN.password);
	const download = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Sicherung erstellen' }).click();
	const dl = await download;
	expect(dl.suggestedFilename()).toMatch(/^ep-intern-sicherung-.*\.epbackup$/);
	backupFile = info.outputPath('sicherung.epbackup');
	await dl.saveAs(backupFile);
	expect((await readFile(backupFile)).byteLength).toBeGreaterThan(100);
	await expect(page.getByText('Sicherung erstellt').first()).toBeVisible();
	await page.screenshot({ path: 'test-results/backup-export-done.png', fullPage: true });
});

test('Rolle anlegen, Import (Wiederherstellen) → Rolle ist wieder weg', async ({ page }) => {
	expect(backupFile).not.toBe('');
	await login(page);
	const name = `Nach Sicherung ${run}`;
	await api(page, 'POST', '/roles', { name, permissions: [] });
	expect(await roleNames(page)).toContain(name);

	await page.goto('/admin/backup?tab=import');
	await expect(page.getByText('1. Sicherungsdatei wählen')).toBeVisible();
	await page.locator('#restore-file').setInputFiles(backupFile);
	await page.getByRole('button', { name: 'Hochladen' }).click();

	await expect(page.getByText('2. Passwörter')).toBeVisible();
	await page.locator('#restore-backup-password').fill(BACKUP_PW);
	await page.locator('#restore-password').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Prüfen' }).click();

	await expect(page.getByText('3. Vorschau')).toBeVisible();
	await expect(page.getByText('Wiederherstellen (ersetzt die gewählten Bereiche)')).toBeVisible();
	await page.getByRole('radio', { name: /Wiederherstellen/ }).check();
	await expect(page.locator('#restore-scope-core-roles')).toHaveAttribute('data-state', 'checked');
	await page.screenshot({ path: 'test-results/backup-preview.png', fullPage: true });
	await page.getByRole('button', { name: 'Weiter zur Bestätigung' }).click();

	await expect(page.getByText('4. Wiederherstellen')).toBeVisible();
	await page.locator('#restore-confirm').fill('WIEDERHERSTELLEN');
	await page.getByRole('button', { name: 'Jetzt wiederherstellen' }).click();
	const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog')).last();
	await confirm.getByRole('button', { name: 'Wiederherstellen', exact: true }).click();

	await expect(page.locator('#main').getByText('Wiederherstellung abgeschlossen')).toBeVisible({
		timeout: 60_000
	});
	await page.screenshot({ path: 'test-results/backup-result.png', fullPage: true });
	expect(await roleNames(page)).not.toContain(name);
	expect(await roleNames(page)).toContain('Administrator');
});

test('Mobil 390 px: Export und Import-Assistent', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await login(page);
	await page.goto('/admin/backup');
	await expect(page.getByRole('heading', { name: 'Datensicherung' })).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(1);
	await page.screenshot({ path: 'test-results/backup-mobile-export.png', fullPage: true });
	await page.goto('/admin/backup?tab=import');
	await expect(page.getByText('1. Sicherungsdatei wählen')).toBeVisible();
	await page.screenshot({ path: 'test-results/backup-mobile-import.png', fullPage: true });
});
