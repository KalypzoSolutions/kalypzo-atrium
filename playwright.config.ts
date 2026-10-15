import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: false,
	workers: 1,
	use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
	webServer: {
		command: 'npm run build && node scripts/e2e-server.mjs',
		url: 'http://localhost:4173/api/v1/health',
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
