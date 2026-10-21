import { expect, test, type Page } from '@playwright/test';

// Nachrichten: Verlauf lädt genau einmal (Regression: Endlosschleife → 429 „Zu viele Anfragen“),
// die Seitenleiste zeigt „Stamm“ nur einmal, und „Neue Nachricht“ hat ein Eingabefeld für Empfänger.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const ORIGIN = 'http://localhost:4173';

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

async function ensureModules(page: Page, ids: string[]) {
	const res = await page.request.fetch('/api/v1/modules', { headers: { origin: ORIGIN } });
	const list = ((await res.json()) as { data: { manifest: { id: string }; enabled: boolean }[] })
		.data;
	for (const id of ids) {
		if (!list.find((m) => m.manifest.id === id)?.enabled) {
			const r = await page.request.fetch(`/api/v1/modules/${id}/enable`, {
				method: 'POST',
				headers: { origin: ORIGIN }
			});
			if (!r.ok()) throw new Error(`enable ${id}: ${r.status()} ${await r.text()}`);
		}
	}
}

test.describe.configure({ mode: 'serial' });

test('Verlauf lädt nur einmal je Aufruf, auch nach mehrfachem Neuladen', async ({ page }) => {
	await login(page);
	await ensureModules(page, ['members', 'messages']);

	let requests = 0;
	page.on('request', (r) => {
		if (/\/api\/v1\/modules\/messages\/messages(\?|$)/.test(r.url())) requests++;
	});
	for (let i = 0; i < 4; i++) {
		requests = 0;
		await page.goto('/modules/messages');
		await expect(page.getByRole('heading', { name: 'Nachrichten', exact: true })).toBeVisible();
		await expect(
			page.getByText(/noch keine nachrichten/i).or(page.getByRole('row').nth(1))
		).toBeVisible();
		// Begründete feste Wartezeit (#75): Eine Effekt-Endlosschleife zeigt sich nur über die Zeit.
		await page.waitForTimeout(1500);
		expect(requests, `Aufruf ${i + 1}`).toBe(1);
		await expect(page.getByText('Zu viele Anfragen')).toHaveCount(0);
	}
});

test('Seitenleiste: „Stamm“ nur einmal, Nachrichten darin', async ({ page }) => {
	await login(page);
	await ensureModules(page, ['members', 'messages']);
	await page.goto('/modules/messages');
	const nav = page.getByRole('navigation').first();
	await expect(nav.getByRole('button', { name: 'Stamm' })).toHaveCount(1);
	await expect(nav.getByRole('link', { name: 'Nachrichten' })).toBeVisible();
});

test('Neue Nachricht: ein Empfängerfeld, Gruppe als Chip, Aussehen wählbar', async ({ page }) => {
	await login(page);
	await ensureModules(page, ['members', 'messages']);
	// Ohne Absender zeigt die Seite nur einen Hinweis: Stamm-Adresse als Absender hinterlegen
	const set = await page.request.fetch('/api/v1/settings', {
		method: 'PUT',
		headers: { origin: ORIGIN, 'content-type': 'application/json' },
		data: { values: { 'core.organization.email': 'stamm@example.test' } }
	});
	expect(set.ok()).toBe(true);
	await page.goto('/modules/messages/new');
	const to = page.getByRole('combobox', { name: 'An' });
	await expect(to).toBeVisible();
	await expect(page.getByLabel('Aussehen')).toBeVisible();
	await expect(page.getByLabel('Gruppen', { exact: true })).toHaveCount(0);
});
