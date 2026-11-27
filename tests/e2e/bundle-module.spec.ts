import { expect, test, type Page } from '@playwright/test';

// Umbau „Module ohne App-Neubau“, Phase 3: `fx-bundle` ist NICHT im App-Build – der E2E-Server kompiliert es erst
// nach dem Build einzeln (scripts/e2e-server.mjs) und lädt es zur Laufzeit. Geprüft: Server-Rendering aus dem
// SSR-Bundle, Browser-Oberfläche aus `/_atrium/modules/…`, CSS des Bundles, Modultexte, Toast über die Instanz des
// Core, API des Moduls – und keine Fehler in der Konsole.

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

test('vorkompiliertes Modul: SSR, Browser-Bundle, CSS, Texte, Toast und API', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		// 429 fremder Anfragen (z. B. Zähler der Seitenleiste) kommen im Gesamtlauf von den gemeinsamen Rate-Limits
		// des E2E-Servers (rules/workflow.md) – Bundle-Dateien werden unten einzeln auf Erfolg geprüft
		if (m.type() === 'error' && !/status of 429/.test(m.text())) errors.push(m.text());
	});
	const failedBundleFiles: string[] = [];
	page.on('response', (r) => {
		if (r.url().includes('/_atrium/modules/fx-bundle/e2e/') && !r.ok())
			failedBundleFiles.push(`${r.status()} ${new URL(r.url()).pathname}`);
	});

	await login(page);
	const modules = (await api(page, 'GET', '/modules')) as {
		manifest: { id: string };
		enabled: boolean;
	}[];
	expect(modules.map((m) => m.manifest.id)).toContain('fx-bundle');
	if (!modules.find((m) => m.manifest.id === 'fx-bundle')?.enabled) {
		await api(page, 'POST', '/modules/fx-bundle/enable');
	}

	// Server-Rendering: die Seite kommt schon im HTML (SSR-Bundle), samt CSS-Link des Bundles im <head>
	const html = await (await page.request.get('/modules/fx-bundle')).text();
	expect(html).toContain('data-testid="fx-bundle-page"');
	expect(html).toContain('Bundle-Seite');
	expect(html).toMatch(/<link[^>]+href="\/_atrium\/modules\/fx-bundle\/e2e\/client\/module\.css"/);
	// Gemeinsames Utilities-CSS (Core + Bundles) als LETZTES Stylesheet – nach dem CSS des Core
	const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(
		(m) => m[1]!
	);
	expect(sheets.at(-1)).toMatch(/^\/_atrium\/modules\/_utilities\/[0-9a-f]{16}\/utilities\.css$/);
	expect(sheets.findIndex((s) => s.includes('/_app/immutable/'))).toBeLessThan(sheets.length - 1);

	// Browser: Oberfläche lädt aus /_atrium/modules/…, hydriert (onMount) und holt Daten über die Modul-API
	const bundleRequests: string[] = [];
	page.on('request', (r) => {
		if (r.url().includes('/_atrium/modules/fx-bundle/'))
			bundleRequests.push(new URL(r.url()).pathname);
	});
	await page.goto('/modules/fx-bundle');
	const card = page.getByTestId('fx-bundle-page');
	await expect(card).toHaveAttribute('data-mounted', 'true');
	await expect(page.getByTestId('fx-bundle-greeting')).toHaveText('Hallo aus dem Bundle');
	// min-h-[13.37rem] steht nur im Modul
	expect(await card.evaluate((el) => getComputedStyle(el).minHeight)).toBe(`${13.37 * 16}px`);
	// Mischfall: `p-4` (auch im Core) + `sm:p-[1.37rem]` (nur im Modul) → ab `sm` gilt die Variante
	expect(
		await page.getByTestId('fx-bundle-greeting').evaluate((el) => getComputedStyle(el).paddingLeft)
	).toBe(`${1.37 * 16}px`);
	// Abstand des Inhaltsbereichs (Core) bleibt unberührt
	expect(await page.locator('main').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(
		'32px'
	);
	expect(bundleRequests.some((p) => p.endsWith('/client/ui.js'))).toBe(true);

	// Toast über das `toast` des Core (ein <Toaster> im Root-Layout) und API des Moduls
	await page.getByTestId('fx-bundle-add').click();
	await expect(page.getByText('Eintrag „Eintrag 1“ angelegt')).toBeVisible();
	await expect(page.getByTestId('fx-bundle-items')).toContainText('Eintrag 1');

	// Auslieferung: lange cachebar, fremde Pfade 404
	const asset = await page.request.get('/_atrium/modules/fx-bundle/e2e/client/ui.js');
	expect(asset.status()).toBe(200);
	expect(asset.headers()['cache-control']).toContain('immutable');
	expect(asset.headers()['content-type']).toContain('javascript');
	expect((await page.request.get('/_atrium/modules/fx-bundle/e2e/meta.json')).status()).toBe(404);
	expect(
		(await page.request.get('/_atrium/modules/fx-bundle/e2e/client/..%2F..%2Fmeta.json')).status()
	).toBe(404);
	expect((await page.request.get('/_atrium/modules/fx-bundle/other/client/ui.js')).status()).toBe(
		404
	);

	expect(errors).toEqual([]);
	expect(failedBundleFiles).toEqual([]);
});
