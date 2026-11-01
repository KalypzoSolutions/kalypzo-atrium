import { defineConfig } from '@playwright/test';
import { modulesDir } from './tools/modules-dir.js';

// Specs rechnen Datumswerte in Lokalzeit (Node) und im Browser: beide wie die Nutzer*innen in
// Europe/Berlin, unabhängig von der Rechner-/CI-Zeitzone (#75, 09-11). Der Server läuft wie im
// Container in UTC (siehe webServer.env), damit Zeitzonenfehler (#32) auffallen.
process.env.TZ = 'Europe/Berlin';

export default defineConfig({
	// Core-Specs (`tests/e2e`) und die Specs der installierten Module (`<Modulverzeichnis>/<id>/e2e`,
	// modulübergreifende in `_integration/e2e`); mit ATRIUM_MODULES_DIR=tests/fixtures/modules nur der Core
	projects: [
		{ name: 'core', testDir: 'tests/e2e' },
		{
			name: 'modules',
			testDir: modulesDir(),
			testMatch: '*/e2e/**/*.spec.ts',
			testIgnore: '_integration/**'
		},
		// zuletzt: modulübergreifende Specs (gleiche Server-Instanz, Reihenfolge wie vor der Aufteilung)
		{ name: 'integration', testDir: `${modulesDir()}/_integration/e2e` }
	],
	fullyParallel: false,
	workers: 1,
	use: {
		baseURL: 'http://localhost:4173',
		trace: 'retain-on-failure',
		timezoneId: 'Europe/Berlin',
		// Oberfläche folgt sonst der Browsersprache (Playwright: en-US); Specs prüfen deutsche Texte
		locale: 'de-DE'
	},
	webServer: {
		command: 'npm run build && node scripts/e2e-server.mjs',
		url: 'http://localhost:4173/api/v1/health',
		// Kein stilles Wiederverwenden eines hängengebliebenen Servers mit altem Build und altem
		// DB-Zustand (#75). Bewusst wiederverwenden: E2E_REUSE_SERVER=1 npx playwright test
		reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
		env: { TZ: 'UTC' },
		timeout: 180_000
	}
});
