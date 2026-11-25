import { expect, test } from '@playwright/test';

test('Module gemeinsam aktivieren und deaktivieren', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill('admin@example.test');
	await page.getByLabel('Passwort').fill('e2e-admin-password-1');
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
	const modules = (await (await page.request.get('/api/v1/modules')).json()) as {
		data: { manifest: { id: string }; enabled: boolean }[];
	};
	const original = new Map(modules.data.map((m) => [m.manifest.id, m.enabled]));
	test.skip(!original.has('fx-board') || !original.has('fx-people'), 'nur mit Fixture-Build');
	async function set(id: string, enabled: boolean) {
		const response = await page.request.post(
			`/api/v1/modules/${id}/${enabled ? 'enable' : 'disable'}`,
			{ headers: { origin: new URL(page.url()).origin } }
		);
		expect(response.ok()).toBeTruthy();
	}
	try {
		if (original.get('fx-consumer')) await set('fx-consumer', false);
		for (const id of ['fx-board', 'fx-people']) if (original.get(id)) await set(id, false);
		await page.goto('/admin/modules');
		await page.getByRole('checkbox', { name: 'Fixture Pinnwand auswählen' }).click();
		await page.getByRole('checkbox', { name: 'Fixture Personen auswählen' }).click();
		const toolbar = page.getByRole('toolbar', { name: 'Sammelaktionen' });
		await toolbar.getByRole('button', { name: 'Aktivieren', exact: true }).click();
		await expect(page.getByText('2 erfolgreich, 0 fehlgeschlagen')).toBeVisible();
		await expect(toolbar.getByText('2 ausgewählt')).toBeVisible();
		await expect(toolbar.getByRole('button', { name: 'Entfernen …' })).toBeDisabled();
		await toolbar.getByRole('button', { name: 'Deaktivieren', exact: true }).click();
		await expect(toolbar.getByRole('button', { name: 'Entfernen …' })).toBeEnabled();
	} finally {
		for (const id of ['fx-board', 'fx-people']) {
			const current = (await (await page.request.get('/api/v1/modules')).json()) as typeof modules;
			if (current.data.find((m) => m.manifest.id === id)?.enabled !== original.get(id))
				await set(id, original.get(id) === true);
		}
		if (original.get('fx-consumer')) await set('fx-consumer', true);
	}
});
