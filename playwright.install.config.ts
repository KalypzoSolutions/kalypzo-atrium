import { defineConfig } from '@playwright/test';

// Modul-Installation mit echtem Neubau über den Supervisor (Kalypzo Atrium, Phase 6). Eigener Lauf, weil er zwei
// Builds braucht (Basis + neue Generation): `npx playwright test -c playwright.install.config.ts`.
process.env.TZ = 'Europe/Berlin';

export default defineConfig({
	testDir: 'tests/e2e-install',
	fullyParallel: false,
	workers: 1,
	timeout: 15 * 60_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL: 'http://localhost:4174',
		trace: 'retain-on-failure',
		timezoneId: 'Europe/Berlin',
		// Oberfläche folgt sonst der Browsersprache (Playwright: en-US); Specs prüfen deutsche Texte
		locale: 'de-DE'
	},
	webServer: {
		command: 'node scripts/e2e-install-server.mjs',
		url: 'http://localhost:4174/api/v1/health',
		reuseExistingServer: false,
		timeout: 10 * 60_000
	}
});
