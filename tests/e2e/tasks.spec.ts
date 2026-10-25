import { expect, test, type Page } from '@playwright/test';

// Aufgaben: Board anlegen, Aufgabe schnell anlegen, im Dialog Priorität + Unteraufgabe setzen, in die
// Erledigt-Spalte verschieben (Spaltenauswahl im Dialog); Karte „Aufgaben“ in der Aktion.

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

async function ensureModules(page: Page, ids: string[]) {
	const list = await api<{ manifest: { id: string }; enabled: boolean }[]>(page, 'GET', '/modules');
	for (const id of ids) {
		if (!list.find((m) => m.manifest.id === id)?.enabled) {
			await api(page, 'POST', `/modules/${id}/enable`);
		}
	}
}

test.describe.configure({ mode: 'serial' });

const boardName = `Lagerplanung ${run}`;
const taskTitle = `Zelte prüfen ${run}`;

test('Board anlegen, Aufgabe bearbeiten und erledigen', async ({ page }) => {
	await login(page);
	await ensureModules(page, ['members', 'actions', 'tasks']);
	await page.goto('/modules/tasks');
	await page.getByRole('button', { name: 'Board anlegen' }).first().click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Name').fill(boardName);
	await dialog.getByRole('button', { name: 'Anlegen' }).click();
	await page.waitForURL(/\/modules\/tasks\/[0-9a-f-]{36}/);
	await expect(page.getByRole('heading', { name: boardName })).toBeVisible();
	for (const col of ['Offen', 'In Arbeit', 'Erledigt']) {
		await expect(page.getByRole('heading', { name: col, exact: true })).toBeVisible();
	}

	// Schnell anlegen in „Offen“
	const quick = page.getByLabel('Neue Aufgabe in Offen');
	await quick.fill(taskTitle);
	await quick.press('Enter');
	const card = page.getByRole('button', { name: new RegExp(taskTitle) });
	await expect(card).toBeVisible();

	// Dialog: Priorität und Unteraufgabe
	await card.click();
	const taskDialog = page.getByRole('dialog');
	await expect(taskDialog.getByLabel('Titel')).toHaveValue(taskTitle);
	await taskDialog.getByLabel('Neue Unteraufgabe').fill('Heringe zählen');
	await taskDialog.getByRole('button', { name: 'Hinzufügen' }).click();
	await expect(taskDialog.getByText('0 von 1 erledigt')).toBeVisible();
	await taskDialog.getByRole('checkbox', { name: '„Heringe zählen“ erledigt' }).click();
	await expect(taskDialog.getByText('1 von 1 erledigt')).toBeVisible();

	// In die Erledigt-Spalte (Auswahl statt Ziehen)
	await taskDialog.getByRole('button', { name: 'Spalte', exact: true }).click();
	await page.getByRole('option', { name: 'Erledigt' }).click();
	await taskDialog.getByRole('button', { name: 'Schließen' }).first().click();
	const doneList = page.getByRole('list', { name: 'Aufgaben in Erledigt' });
	await expect(doneList.getByRole('button', { name: new RegExp(taskTitle) })).toBeVisible();
});

test('Aufgabe per Ziehen in eine andere Spalte verschieben', async ({ page }) => {
	await login(page);
	await page.goto('/modules/tasks');
	await page.getByRole('link', { name: new RegExp(boardName) }).click();
	await page.waitForURL(/\/modules\/tasks\/[0-9a-f-]{36}/);
	const title = `Ziehen ${run}`;
	const quick = page.getByLabel('Neue Aufgabe in Offen');
	await quick.fill(title);
	await quick.press('Enter');
	const card = page
		.getByRole('list', { name: 'Aufgaben in Offen' })
		.getByRole('button', { name: new RegExp(title) });
	await expect(card).toBeVisible();
	await card.dragTo(page.getByRole('list', { name: 'Aufgaben in In Arbeit' }));
	await expect(
		page
			.getByRole('list', { name: 'Aufgaben in In Arbeit' })
			.getByRole('button', { name: new RegExp(title) })
	).toBeVisible();
	await page.reload();
	await expect(
		page
			.getByRole('list', { name: 'Aufgaben in In Arbeit' })
			.getByRole('button', { name: new RegExp(title) })
	).toBeVisible();
});

test('Aktion: Karte „Aufgaben“ legt ein Board an', async ({ page }) => {
	await login(page);
	await ensureModules(page, ['members', 'actions', 'tasks']);
	const action = await api<{ id: string }>(page, 'POST', '/modules/actions/actions', {
		name: `Fahrt ${run}`,
		startsOn: '2027-05-01'
	});
	await page.goto(`/modules/actions/${action.id}`);
	await page.getByRole('button', { name: 'Board anlegen' }).click();
	await page.waitForURL(/\/modules\/tasks\/[0-9a-f-]{36}/);
	await expect(page.getByRole('heading', { name: `Fahrt ${run}`, level: 1 })).toBeVisible();
	await page.goto(`/modules/actions/${action.id}`);
	await expect(page.getByRole('link', { name: 'Board öffnen' })).toBeVisible();
});
