import { expect, test, type Page } from '@playwright/test';

// Material: Bestand anzeigen und Stück-Blatt öffnen, Scan-Seite löst einen Code auf, Reservierung mit
// Bahnen-Anfrage im Dialog, Etiketten-Designer lädt ein Layout, echtes Etiketten-PDF (Chromium).

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const ORIGIN = 'http://localhost:4173';
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

interface Unit {
	id: string;
	code: string;
	name: string;
}

async function setup(page: Page) {
	await login(page);
	const list = await api<{ manifest: { id: string }; enabled: boolean }[]>(page, 'GET', '/modules');
	if (!list.find((m) => m.manifest.id === 'material')?.enabled) {
		await api(page, 'POST', '/modules/material/enable');
	}
	const M = '/modules/material';
	const loc = await api<{ id: string }>(page, 'POST', `${M}/locations`, { name: `Raum ${run}` });
	const bahn = await api<{ id: string }>(page, 'POST', `${M}/articles`, {
		name: `Kohtenbahn ${run}`,
		kind: 'unit'
	});
	const units = await api<Unit[]>(page, 'POST', `${M}/units`, {
		articleId: bahn.id,
		count: 4,
		locationId: loc.id
	});
	return { M, bahn, units };
}

test('Bestand, Scan-Seite und Stück-Blatt', async ({ page }) => {
	const { units } = await setup(page);
	const first = units[0]!;
	await page.goto(`/modules/material/lager`);
	await page.getByRole('searchbox').first().fill(first.code);
	await expect(page.getByText(first.name).first()).toBeVisible();

	await page.goto(`/modules/material/scan/${first.code}`);
	await expect(page.getByText(first.name).first()).toBeVisible();

	await page.goto(`/modules/material/lager?open=${first.id}`);
	await expect(page.getByRole('dialog').getByText(first.code).first()).toBeVisible();
});

test('Reservierung anlegen (Bahnen-Anfrage) und öffnen', async ({ page }) => {
	const { M, bahn } = await setup(page);
	const r = await api<{ id: string; title: string }>(page, 'POST', `${M}/reservations`, {
		title: `Lager ${run}`,
		startsOn: '2030-07-01',
		endsOn: '2030-07-05',
		lines: [{ kind: 'article', articleId: bahn.id, quantity: 3 }]
	});
	await page.goto(`/modules/material/reservierung/${r.id}`);
	await expect(page.getByRole('heading', { level: 1, name: `Lager ${run}` })).toBeVisible();
	await expect(page.getByText(`Kohtenbahn ${run}`).first()).toBeVisible();
	const pdf = await page.request.get(`/api/v1${M}/reservations/${r.id}/handout.pdf`);
	expect(pdf.status()).toBe(200);
	// mehr als vorhanden → 409
	const res = await page.request.post(`/api/v1${M}/reservations`, {
		headers: { origin: ORIGIN, 'content-type': 'application/json' },
		data: JSON.stringify({
			title: `Zu viel ${run}`,
			startsOn: '2030-07-02',
			endsOn: '2030-07-03',
			lines: [{ kind: 'article', articleId: bahn.id, quantity: 2 }]
		})
	});
	expect(res.status()).toBe(409);
});

test('Etiketten: Designer lädt Layout, PDF wird erzeugt', async ({ page }) => {
	const { M, units } = await setup(page);
	const tpl = await api<{ id: string }>(page, 'POST', `${M}/label-templates`, {
		name: `Bahn ${run}`,
		target: 'unit',
		formatKey: 'brother-62x29',
		layout: {
			widthMm: 62,
			heightMm: 29,
			elements: [
				{
					id: 'n',
					type: 'text',
					x: 2,
					y: 2,
					w: 58,
					h: 6,
					text: '{name}',
					fontSizePt: 11,
					bold: true,
					align: 'left',
					valign: 'top',
					maxLines: 1
				},
				{
					id: 'b',
					type: 'barcode',
					x: 2,
					y: 9,
					w: 58,
					h: 12,
					symbology: 'code128',
					value: '{code}'
				}
			]
		}
	});
	await page.goto(`/modules/material/labels/${tpl.id}`);
	await expect(page.locator('input').first()).toHaveValue(`Bahn ${run}`);

	const pdf = await page.request.post(`/api/v1${M}/labels.pdf`, {
		headers: { origin: ORIGIN, 'content-type': 'application/json' },
		data: JSON.stringify({ templateId: tpl.id, target: 'unit', ids: units.map((u) => u.id) })
	});
	expect(pdf.status()).toBe(200);
	const body = await pdf.body();
	expect(body.subarray(0, 5).toString()).toBe('%PDF-');
});

test('Ausleihen: Artikel in die Merkliste und reservieren', async ({ page }) => {
	const { bahn } = await setup(page);
	void bahn;
	await page.goto(`/modules/material?from=2031-05-02&to=2031-05-03`);
	await page.getByRole('searchbox').first().fill(`Kohtenbahn ${run}`);
	const plus = page.getByRole('button', { name: `Menge Kohtenbahn ${run} erhöhen` }).first();
	await plus.click();
	await plus.click();
	await page.getByRole('button', { name: 'Reservieren' }).first().click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel(/Titel/).fill(`Wochenende ${run}`);
	await dialog.getByRole('button', { name: 'Reservieren' }).click();
	await page.waitForURL(/\/modules\/material\/reservierung\//);
	await expect(page.getByRole('heading', { level: 1, name: `Wochenende ${run}` })).toBeVisible();
	await expect(page.getByText(`Kohtenbahn ${run}`).first()).toBeVisible();
});
