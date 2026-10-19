import {
	expect,
	test,
	type APIRequestContext,
	type BrowserContext,
	type Locator,
	type Page
} from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';
import { startS3Mock, type S3Mock } from '../helpers/s3-mock';

// Dateien (Cloud-Ablage) mit S3-Ersatz: Ordner anlegen und navigieren, Upload per Drag & Drop und
// Dateiauswahl, Bild- und PDF-Vorschau, Verschieben per Drag & Drop, Papierkorb mit Rückgängig und
// Wiederherstellen, öffentlicher Link ohne Login (auch mit Passwort).
// Die E2E-Instanz hat kein S3 – die Spec stellt den Speicher vorübergehend auf einen lokalen Ersatz
// (`tests/helpers/s3-mock.ts`) um und setzt die Einstellungen danach zurück (andere Specs erwarten 503).

const ADMIN = { email: 'admin@example.test', password: 'e2e-admin-password-1' };
const ORIGIN = 'http://localhost:4173';
const API = '/api/v1/modules/files';
const DRAG_MIME = 'application/x-ep-files-nodes';
const run = Date.now().toString(36);

const ROOT = `E2E Ablage ${run}`;
const SUB = 'Unterordner';
const IMG1 = 'Bild-1.png';
const IMG2 = 'Bild-2.png';
const PDF_NAME = 'Elternbrief.pdf';
const TXT_NAME = 'Notizen.txt';
const LINK_PASSWORD = 'Zeltlager-2026';

const STORAGE_KEYS = {
	endpoint: 'core.storage.endpoint',
	region: 'core.storage.region',
	bucket: 'core.storage.bucket',
	accessKeyId: 'core.storage.accessKeyId',
	secretAccessKey: 'core.storage.secretAccessKey',
	forcePathStyle: 'core.storage.forcePathStyle'
} as const;
const SECRET_KEYS: string[] = [STORAGE_KEYS.accessKeyId, STORAGE_KEYS.secretAccessKey];

interface PublicSetting {
	key: string;
	secret: boolean;
	value: unknown;
	isSet: boolean;
}
interface FileNode {
	id: string;
	name: string;
	kind: 'folder' | 'file';
	contentType: string | null;
}
interface FolderListing {
	items: FileNode[];
}

const PDF = Buffer.from(
	[
		'%PDF-1.4',
		'1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
		'2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
		'3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
		'4 0 obj<</Length 44>>stream',
		'BT /F1 24 Tf 72 760 Td (Elternbrief) Tj ET',
		'endstream endobj',
		'5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
		'trailer<</Root 1 0 R>>',
		'%%EOF'
	].join('\n')
);

/**
 * Einfarbiges PNG ohne `sharp` (Playwrights Modul-Lader verträgt sharp nicht): 320 × 240, RGB.
 * `color` als `#rrggbb`.
 */
async function picture(color: string): Promise<Buffer> {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
	const width = 320;
	const height = 240;
	const row = Buffer.alloc(1 + width * 3);
	for (let x = 0; x < width; x++) row.set([r!, g!, b!], 1 + x * 3);
	const raw = Buffer.concat(Array.from({ length: height }, () => row));
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([len, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// --- Hilfen ------------------------------------------------------------------------------

async function login(page: Page) {
	await page.goto('/login');
	await page.getByLabel('E-Mail').fill(ADMIN.email);
	await page.getByLabel('Passwort').fill(ADMIN.password);
	await page.getByRole('button', { name: 'Anmelden' }).click();
	await page.waitForURL(/\/dashboard/);
}

async function call<T>(
	req: APIRequestContext,
	method: string,
	path: string,
	body?: unknown
): Promise<T> {
	const res = await req.fetch(`/api/v1${path}`, {
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

const api = <T>(page: Page, method: string, path: string, body?: unknown) =>
	call<T>(page.request, method, path, body);

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Eintrag der Dateiliste (Raster/Liste): `aria-label` = „<Name>, <Art>“ */
function item(page: Page, name: string): Locator {
	return page.getByRole('option', { name: new RegExp(`^${escapeRe(name)},`) });
}

function toast(page: Page, text: string | RegExp): Locator {
	return page.locator('[data-sonner-toast]').filter({ hasText: text });
}

async function listing(page: Page, parent?: string): Promise<FileNode[]> {
	const q = new URLSearchParams({ space: 'personal', ...(parent ? { parent } : {}) });
	return (await api<FolderListing>(page, 'GET', `/modules/files/nodes?${q.toString()}`)).items;
}

async function nodeByName(page: Page, name: string, parent?: string): Promise<FileNode> {
	const node = (await listing(page, parent)).find((n) => n.name === name);
	if (!node) throw new Error(`Knoten „${name}“ nicht gefunden`);
	return node;
}

async function openFolder(page: Page, id: string) {
	await page.goto(`/modules/files?folder=${id}`);
	await expect(page.getByRole('listbox', { name: 'Dateien und Ordner' })).toBeVisible();
}

// --- Speicher umstellen und zurücksetzen --------------------------------------------------

let s3: S3Mock | undefined;
let context: BrowserContext | undefined;
/** Eine angemeldete Seite für alle Tests (Better Auth begrenzt Anmeldungen auf 10/min) */
let page: Page;
let original: PublicSetting[] = [];
let rootId = '';
let subId = '';

test.describe.serial('Dateien', () => {
	test.beforeAll(async ({ browser }) => {
		s3 = await startS3Mock();
		context = await browser.newContext({ baseURL: ORIGIN });
		page = await context.newPage();
		await login(page);
		const admin = page.request;

		const all = await call<PublicSetting[]>(admin, 'GET', '/settings?group=storage');
		const keys = Object.values(STORAGE_KEYS) as string[];
		original = all.filter((s) => keys.includes(s.key));

		// Der Ersatz prüft keine Signaturen: vorhandene Zugangsdaten bleiben, sonst Platzhalter
		const values: Record<string, unknown> = {
			[STORAGE_KEYS.endpoint]: s3.endpoint,
			[STORAGE_KEYS.region]: 'us-east-1',
			[STORAGE_KEYS.bucket]: 'e2e-files',
			[STORAGE_KEYS.forcePathStyle]: true
		};
		for (const key of SECRET_KEYS) {
			if (!original.find((s) => s.key === key)?.isSet) values[key] = `e2e-${key.split('.').pop()}`;
		}
		await call(admin, 'PUT', '/settings', { values });

		const modules = await call<{ manifest: { id: string }; enabled: boolean }[]>(
			admin,
			'GET',
			'/modules'
		);
		for (const id of ['members', 'files']) {
			if (!modules.find((m) => m.manifest.id === id)?.enabled) {
				await call(admin, 'POST', `/modules/${id}/enable`);
			}
		}
	});

	test.afterAll(async () => {
		try {
			if (context && original.length) {
				const values: Record<string, unknown> = {};
				for (const s of original) {
					// Secrets kommen nie zurück: nur löschen, was die Spec selbst gesetzt hat
					if (s.secret) {
						if (!s.isSet) values[s.key] = null;
					} else values[s.key] = s.value;
				}
				await call(page.request, 'PUT', '/settings', { values });
			}
		} finally {
			await context?.close();
			await s3?.close();
		}
	});

	test('Ordner anlegen, hineinnavigieren, Breadcrumbs zurück', async () => {
		await page.goto('/modules/files');
		await expect(page.getByRole('heading', { name: 'Dateien', exact: true })).toBeVisible();

		// Wurzelordner über „Neuer Ordner“
		await page.getByRole('button', { name: 'Neuer Ordner' }).click();
		let dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name *').fill(ROOT);
		await dialog.getByRole('button', { name: 'Anlegen' }).click();
		await expect(dialog).toBeHidden();
		await expect(toast(page, 'Ordner angelegt')).toBeVisible();
		await expect(item(page, ROOT)).toBeVisible();

		// Hineinnavigieren (Doppelklick)
		await item(page, ROOT).dblclick();
		await page.waitForURL(/[?&]folder=[0-9a-f-]{36}/);
		rootId = new URL(page.url()).searchParams.get('folder')!;
		const crumbs = page.getByRole('navigation', { name: 'Ordnerpfad' });
		await expect(crumbs.locator('[aria-current="page"]')).toHaveText(ROOT);
		await expect(page.getByText('Dieser Ordner ist leer')).toBeVisible();

		// Unterordner anlegen und öffnen
		await page.getByRole('button', { name: 'Neuer Ordner' }).click();
		dialog = page.getByRole('dialog');
		await dialog.getByLabel('Name *').fill(SUB);
		await dialog.getByRole('button', { name: 'Anlegen' }).click();
		await expect(dialog).toBeHidden();
		await item(page, SUB).dblclick();
		await expect(crumbs.locator('[aria-current="page"]')).toHaveText(SUB);
		subId = new URL(page.url()).searchParams.get('folder')!;
		expect(subId).not.toBe(rootId);

		// Breadcrumbs zurück: erst zum Wurzelordner, dann zu „Meine Dateien“
		await crumbs.getByRole('button', { name: ROOT }).click();
		await expect(crumbs.locator('[aria-current="page"]')).toHaveText(ROOT);
		await expect(item(page, SUB)).toBeVisible();
		expect(new URL(page.url()).searchParams.get('folder')).toBe(rootId);

		await crumbs.getByRole('button', { name: 'Meine Dateien' }).click();
		await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Meine Dateien');
		await expect(item(page, ROOT)).toBeVisible();
		expect(new URL(page.url()).searchParams.get('folder')).toBeNull();
	});

	test('Upload per Drag & Drop', async () => {
		await openFolder(page, rootId);

		const files = [
			{ name: IMG1, type: 'image/png', b64: (await picture('#2563eb')).toString('base64') },
			{ name: IMG2, type: 'image/png', b64: (await picture('#16a34a')).toString('base64') }
		];
		const dt = await page.evaluateHandle((list) => {
			const d = new DataTransfer();
			for (const f of list) {
				const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
				d.items.add(new File([bytes], f.name, { type: f.type }));
			}
			return d;
		}, files);

		// Externe Dateien landen über das Listenelement in der Upload-Zone des aktuellen Ordners
		const target = page.getByRole('listbox', { name: 'Dateien und Ordner' });
		await target.dispatchEvent('dragenter', { dataTransfer: dt });
		await target.dispatchEvent('dragover', { dataTransfer: dt });
		await expect(page.getByText('Zum Hochladen loslassen')).toBeVisible();
		await target.dispatchEvent('drop', { dataTransfer: dt });

		await expect(toast(page, '2 Dateien hochgeladen')).toBeVisible({ timeout: 20_000 });
		await expect(item(page, IMG1)).toBeVisible();
		await expect(item(page, IMG2)).toBeVisible();
		expect(s3!.size()).toBeGreaterThanOrEqual(2);
	});

	test('Upload per Dateiauswahl', async () => {
		await openFolder(page, rootId);

		await page.getByRole('button', { name: 'Hochladen', exact: true }).click();
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.getByRole('menuitem', { name: 'Dateien' }).click()
		]);
		expect(chooser.isMultiple()).toBe(true);
		await chooser.setFiles([
			{ name: PDF_NAME, mimeType: 'application/pdf', buffer: PDF },
			{
				name: TXT_NAME,
				mimeType: 'text/plain',
				buffer: Buffer.from('Schlafsack\nIsomatte\nTaschenlampe\n')
			}
		]);

		await expect(toast(page, '2 Dateien hochgeladen')).toBeVisible({ timeout: 20_000 });
		await expect(item(page, PDF_NAME)).toBeVisible();
		await expect(item(page, TXT_NAME)).toBeVisible();
	});

	test('Bildvorschau mit Blättern und PDF-Vorschau', async () => {
		await openFolder(page, rootId);

		// Bild: Doppelklick öffnet die Vorschau, Pfeil rechts blättert zum nächsten Bild
		await item(page, IMG1).dblclick();
		const preview = page.getByRole('dialog');
		await expect(preview).toBeVisible();
		const img1 = preview.locator(`img[alt="${IMG1}"]`);
		await expect(img1).toBeVisible();
		await expect
			.poll(() => img1.evaluate((el) => (el as HTMLImageElement).naturalWidth))
			.toBeGreaterThan(0);
		await page.keyboard.press('ArrowRight');
		await expect(preview.locator(`img[alt="${IMG2}"]`)).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(preview).toBeHidden();

		// PDF: Headless-Chromium hat keinen PDF-Viewer → iframe oder Ausweichkarte
		await item(page, PDF_NAME).dblclick();
		await expect(preview).toBeVisible();
		await expect(
			preview.locator('iframe').or(preview.getByRole('link', { name: 'In neuem Tab öffnen' }))
		).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(preview).toBeHidden();

		// Inhalt kommt als PDF aus dem Speicher
		const pdf = await nodeByName(page, PDF_NAME, rootId);
		const res = await page.request.get(`${API}/nodes/${pdf.id}/content`);
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain('application/pdf');
		expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
	});

	test('Verschieben per Drag & Drop', async () => {
		await openFolder(page, rootId);
		const img2 = await nodeByName(page, IMG2, rootId);

		const source = item(page, IMG2);
		const target = item(page, SUB);
		await expect(source).toBeVisible();
		// HTML5-DnD mit eigenem DataTransfer: dragstart setzt die IDs (DRAG_MIME), drop liest sie
		const dt = await page.evaluateHandle(
			({ mime, ids }) => {
				const d = new DataTransfer();
				d.setData(mime, JSON.stringify(ids));
				return d;
			},
			{ mime: DRAG_MIME, ids: [img2.id] }
		);
		await source.dispatchEvent('dragstart', { dataTransfer: dt });
		await target.dispatchEvent('dragenter', { dataTransfer: dt });
		await target.dispatchEvent('dragover', { dataTransfer: dt });
		await target.dispatchEvent('drop', { dataTransfer: dt });

		await expect(toast(page, `Nach „${SUB}“ verschoben`)).toBeVisible();
		await expect(item(page, IMG2)).toBeHidden();
		expect((await listing(page, subId)).map((n) => n.name)).toContain(IMG2);
		expect((await listing(page, rootId)).map((n) => n.name)).not.toContain(IMG2);
	});

	test('Papierkorb: Rückgängig und Wiederherstellen', async () => {
		await openFolder(page, rootId);

		const trash = async () => {
			await page.getByRole('button', { name: `Aktionen für ${TXT_NAME}` }).click();
			await page.getByRole('menuitem', { name: 'In den Papierkorb' }).click();
			const confirm = page.getByRole('alertdialog');
			await expect(confirm).toContainText(`„${TXT_NAME}“ in den Papierkorb?`);
			await confirm.getByRole('button', { name: 'In den Papierkorb' }).click();
			await expect(confirm).toBeHidden();
			await expect(toast(page, `„${TXT_NAME}“ liegt im Papierkorb`)).toBeVisible();
			await expect(item(page, TXT_NAME)).toBeHidden();
		};

		// Löschen + Rückgängig im Toast
		await trash();
		await toast(page, `„${TXT_NAME}“ liegt im Papierkorb`)
			.getByRole('button', { name: 'Rückgängig' })
			.click();
		await expect(toast(page, 'Wiederhergestellt')).toBeVisible();
		await expect(item(page, TXT_NAME)).toBeVisible();

		// Erneut löschen, im Papierkorb-Tab wiederherstellen
		await trash();
		await page.getByRole('tab', { name: 'Papierkorb' }).click();
		await expect(page).toHaveURL(/view=trash/);
		const restore = page.getByRole('button', { name: `${TXT_NAME} wiederherstellen` });
		await expect(restore).toBeVisible();
		await expect(page.getByText(new RegExp(escapeRe(ROOT))).first()).toBeVisible();
		await restore.click();
		await expect(restore).toBeHidden();

		await openFolder(page, rootId);
		await expect(item(page, TXT_NAME)).toBeVisible();
	});

	test('Öffentlicher Link ohne Login, auch mit Passwort', async ({ browser }) => {
		await page.goto('/modules/files');
		await expect(item(page, ROOT)).toBeVisible();

		const createLink = async (password: string | null): Promise<string> => {
			await page.getByRole('button', { name: `Aktionen für ${ROOT}` }).click();
			await page.getByRole('menuitem', { name: 'Öffentlicher Link' }).click();
			const dialog = page.getByRole('dialog', { name: new RegExp(escapeRe(ROOT)) });
			await expect(dialog).toBeVisible();
			if (password) {
				await dialog.locator('#files-link-use-password').click();
				await dialog.locator('input[type="password"]').fill(password);
			}
			await dialog.getByRole('button', { name: 'Link erstellen' }).click();
			const urlInput = dialog.locator('#files-link-url');
			await expect(urlInput).toHaveValue(/\/p\/files\/link\/[A-Za-z0-9_-]{20,}$/);
			const url = await urlInput.inputValue();
			await dialog.getByRole('button', { name: 'Schließen' }).last().click();
			await expect(dialog).toBeHidden();
			return url;
		};

		const openUrl = await createLink(null);
		const lockedUrl = await createLink(LINK_PASSWORD);
		expect(lockedUrl).not.toBe(openUrl);

		// Neuer Context ohne Anmeldung
		const guest = await browser.newContext({ baseURL: ORIGIN });
		try {
			const pub = await guest.newPage();
			await pub.goto(openUrl);
			await expect(pub).toHaveURL(/\/p\/files\/link\//);
			await expect(pub.getByRole('heading', { name: ROOT })).toBeVisible();
			await expect(pub.getByRole('button', { name: `Ordner ${SUB} öffnen` })).toBeVisible();
			await expect(pub.getByRole('button', { name: `${PDF_NAME} ansehen` })).toBeVisible();
			await pub.getByRole('button', { name: `${IMG1} ansehen` }).click();
			const preview = pub.getByRole('dialog');
			await expect(preview).toBeVisible();
			const img = preview.locator(`img[alt="${IMG1}"]`);
			await expect(img).toBeVisible();
			await expect
				.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
				.toBeGreaterThan(0);
			await pub.keyboard.press('Escape');

			// Unterordner im öffentlichen Link
			await pub.getByRole('button', { name: `Ordner ${SUB} öffnen` }).click();
			await expect(pub.getByRole('heading', { name: SUB })).toBeVisible();
			await expect(pub.getByRole('button', { name: `${IMG2} ansehen` })).toBeVisible();

			// Passwort-Link: erst Formular, falsches Passwort → Meldung, richtiges → Inhalt
			await pub.goto(lockedUrl);
			await expect(pub.getByText('ist mit einem Passwort geschützt')).toBeVisible();
			await expect(pub.getByRole('button', { name: `${IMG1} ansehen` })).toBeHidden();
			await pub.locator('#link-password').fill('falsches-passwort');
			await pub.getByRole('button', { name: 'Öffnen', exact: true }).click();
			await expect(pub.getByText('Das Passwort ist falsch.')).toBeVisible();
			await pub.locator('#link-password').fill(LINK_PASSWORD);
			await pub.getByRole('button', { name: 'Öffnen', exact: true }).click();
			await expect(pub.getByRole('heading', { name: ROOT })).toBeVisible();
			await expect(pub.getByRole('button', { name: `${IMG1} ansehen` })).toBeVisible();
		} finally {
			await guest.close();
		}
	});
});
