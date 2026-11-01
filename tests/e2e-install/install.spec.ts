import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync } from 'fflate';

// Modul per ZIP im Panel installieren → Supervisor baut neu → Neustart → Modul ist da und lässt sich aktivieren.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const FIXTURES = join(process.cwd(), 'tests', 'fixtures', 'modules');

function zipOf(id: string): Buffer {
	const files: Record<string, Uint8Array> = {};
	const base = join(FIXTURES, id);
	const walk = (d: string) => {
		for (const n of readdirSync(d)) {
			const p = join(d, n);
			if (statSync(p).isDirectory()) walk(p);
			else files[`${id}/${relative(base, p).split('\\').join('/')}`] = readFileSync(p);
		}
	};
	walk(base);
	return Buffer.from(zipSync(files));
}

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

test('Modul aus ZIP installieren, neu bauen und aktivieren', async ({ page }) => {
	await login(page);
	await page.goto('/admin/modules');
	await expect(page.getByText('Fixture Personen')).toBeVisible();
	await expect(page.getByText('Fixture Pinnwand')).toHaveCount(0);

	await page.goto('/admin/modules/install');
	await page.locator('input[type=file]').setInputFiles({
		name: 'fx-board.zip',
		mimeType: 'application/zip',
		buffer: zipOf('fx-board')
	});
	await page.getByRole('button', { name: 'Quelle laden' }).click();
	await expect(page.getByText('2. Module auswählen')).toBeVisible();
	await page.getByRole('button', { name: 'Vorschau anzeigen' }).click();
	await expect(page.getByText('3. Vorschau')).toBeVisible();
	await expect(page.getByText('0001_init, 0002_events')).toBeVisible();
	await page.getByLabel('Ich habe die Quelle geprüft und vertraue ihr.').click();
	await page.getByLabel('Dein Konto-Passwort *').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Installieren' }).click();

	// Neubau läuft, danach Neustart (Seite fragt den Stand selbst ab)
	await expect(page.getByRole('heading', { name: /^Neubau/ })).toBeVisible();
	await expect(page.getByText('Fertig', { exact: true })).toBeVisible({ timeout: 12 * 60_000 });

	await page.goto('/admin/modules');
	const card = page.locator('[data-slot="card"]', { hasText: 'Fixture Pinnwand' });
	await expect(card).toBeVisible();
	await card.getByRole('button', { name: 'Aktivieren' }).click();
	await expect(card.getByText('Aktiv', { exact: true })).toBeVisible();

	await page.goto('/modules/fx-board');
	await expect(page.getByTestId('fx-board-page')).toBeVisible();

	await page.goto('/admin/modules/history');
	await expect(page.getByRole('cell', { name: 'fx-board' }).first()).toBeVisible();
	await expect(page.getByText('Fertig').first()).toBeVisible();

	// Wieder entfernen (Daten behalten): deaktivieren → Entfernen → Neubau ohne das Modul
	await page.goto('/admin/modules');
	const board = page.locator('[data-slot="card"]', { hasText: 'Fixture Pinnwand' });
	await board.getByRole('button', { name: 'Deaktivieren' }).click();
	await expect(board.getByText('Inaktiv', { exact: true })).toBeVisible();
	await board.getByRole('button', { name: 'Entfernen …' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Dein Konto-Passwort *').fill(ADMIN.password);
	await dialog.getByRole('button', { name: 'Entfernen' }).click();
	await expect(dialog).toHaveCount(0);
	// Neubau + Neustart abwarten: Karte verschwindet, Daten bleiben („Nicht installiert“)
	await expect
		.poll(
			async () => {
				try {
					await page.goto('/admin/modules');
					// Problem-Karte trägt nur die ID; die Karte mit dem Namen ist weg
					const missing = await page
						.locator('[data-slot="card"]', { hasText: 'fx-board' })
						.getByText('Nicht installiert', { exact: true })
						.count();
					const loaded = await page.getByText('Fixture Pinnwand').count();
					return missing === 1 && loaded === 0 ? 1 : 0;
				} catch {
					return 0;
				}
			},
			{ timeout: 12 * 60_000, intervals: [5000] }
		)
		.toBe(1);
});
