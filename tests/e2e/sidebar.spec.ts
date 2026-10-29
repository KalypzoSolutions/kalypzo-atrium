import { expect, test, type Page } from '@playwright/test';

// Seitenleiste (Desktop): einklappen zur Symbolleiste, Name als Tooltip, Zustand bleibt nach Reload
// (Cookie `sidebar`), Klick auf „Administration“ klappt aus und öffnet die Gruppe.

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
/** Optional: Screenshots für die visuelle Prüfung ablegen (`SIDEBAR_SHOTS=<Ordner>`) */
const SHOTS = process.env.SIDEBAR_SHOTS;

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

test('Seitenleiste lässt sich einklappen und merkt sich den Zustand', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page);
	const sidebar = page.getByTestId('app-sidebar');
	const nav = sidebar.getByRole('navigation', { name: 'Hauptnavigation' });
	await expect(sidebar).toBeVisible();
	await expect(nav.getByText('Dashboard', { exact: true })).toBeVisible();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/sidebar-offen.png` });

	await sidebar.getByTestId('sidebar-toggle').click();
	await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
	await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(60);
	// Name nur noch für Screenreader, sichtbar als Tooltip
	const dash = nav.getByRole('link', { name: 'Dashboard' });
	await expect(dash).toBeVisible();
	await dash.hover();
	await expect(page.locator('[data-slot="tooltip-content"]').getByText('Dashboard')).toBeVisible();
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/sidebar-zu.png` });

	// Nach Reload weiter eingeklappt (serverseitig aus dem Cookie, ohne Springen)
	await page.reload();
	await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
	expect((await page.context().cookies()).find((c) => c.name === 'sidebar')?.value).toBe(
		'collapsed'
	);

	// Gruppe „Administration“ klappt die Leiste aus und öffnet sich
	await nav.getByRole('button', { name: /Administration/ }).click();
	await expect(sidebar).not.toHaveAttribute('data-collapsed', 'true');
	await expect(nav.getByRole('link', { name: 'Übersicht' })).toBeVisible();

	// Wieder einklappen und ausklappen über den Knopf
	await sidebar.getByTestId('sidebar-toggle').click();
	await sidebar.getByTestId('sidebar-toggle').click();
	await expect(nav.getByText('Dashboard', { exact: true })).toBeVisible();
	await page.reload();
	await expect(sidebar).not.toHaveAttribute('data-collapsed', 'true');
});
