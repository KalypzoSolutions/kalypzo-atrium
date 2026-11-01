// Screenshots von Seiten der laufenden Demo-App (visuelle Prüfung während der Entwicklung).
//
//   node scripts/screenshots.mjs --out .data/shots /modules/actions /modules/actions/<id>
//   node scripts/screenshots.mjs --out .data/shots --tab Kalkulation --mobile /modules/actions/<id>
//
// Optionen: --out <Ordner> (Pflicht) --base <URL> (Standard http://localhost:4300)
//           --user <E-Mail> --pass <Passwort> (Standard: Demo-Admin)
//           --tab <Name>   klickt nach dem Laden den Tab mit diesem Namen
//           --click <Text> klickt danach einen Button mit diesem Namen (z. B. ein Menü öffnen)
//           --mobile       zusätzlich 390×844 (iPhone-Breite); --full  ganze Seite statt Ausschnitt
//           --wait <ms>    Wartezeit vor dem Screenshot (Standard 500)
//           --locale <tag> Browsersprache (Standard de-DE; en-US zeigt die englische Oberfläche, wenn die Systemsprache „automatisch“ ist)
// Voraussetzung: `node scripts/demo-server.mjs` läuft; Chromium via `npx playwright install chromium`.
import { mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		out: { type: 'string' },
		base: { type: 'string', default: 'http://localhost:4300' },
		locale: { type: 'string', default: 'de-DE' },
		user: { type: 'string', default: 'admin@demo.test' },
		pass: { type: 'string', default: 'Demo-Admin-2026!' },
		tab: { type: 'string' },
		click: { type: 'string' },
		mobile: { type: 'boolean', default: false },
		full: { type: 'boolean', default: true },
		wait: { type: 'string', default: '500' }
	}
});

if (!values.out || positionals.length === 0) {
	console.error('Aufruf: node scripts/screenshots.mjs --out <Ordner> [Optionen] <Pfad> [<Pfad> …]');
	process.exit(1);
}
mkdirSync(values.out, { recursive: true });

const slug = (p) =>
	p
		.replace(/^\/+/, '')
		.replace(/[^a-zA-Z0-9]+/g, '-')
		.slice(0, 60) || 'start';
const viewports = [{ name: 'desktop', width: 1440, height: 900 }];
if (values.mobile) viewports.push({ name: 'mobile', width: 390, height: 844 });

const browser = await chromium.launch();
try {
	for (const vp of viewports) {
		const context = await browser.newContext({
			viewport: { width: vp.width, height: vp.height },
			locale: values.locale
		});
		const page = await context.newPage();
		await page.goto(`${values.base}/login`);
		// sprachunabhängig (Oberfläche de/en)
		await page.locator('input[name="email"]').fill(values.user);
		await page.locator('input[name="password"]').fill(values.pass);
		await page.locator('form button[type="submit"]').first().click();
		await page.waitForURL(/dashboard/);

		for (const path of positionals) {
			await page.goto(`${values.base}${path}`);
			await page.waitForLoadState('networkidle');
			if (values.tab) await page.getByRole('tab', { name: values.tab }).click();
			if (values.click) await page.getByRole('button', { name: values.click }).first().click();
			await page.waitForTimeout(Number(values.wait));
			const file = `${values.out}/${slug(path)}${values.tab ? `-${slug(values.tab)}` : ''}-${vp.name}.png`;
			await page.screenshot({ path: file, fullPage: values.full && !values.click });
			console.log(file);
		}
		await context.close();
	}
} finally {
	await browser.close();
}
