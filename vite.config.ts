import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { atriumModules } from './tools/vite-plugin-atrium-modules.ts';
import { modulesDir } from './tools/modules-dir.js';

const MODULES = modulesDir();

export default defineConfig({
	plugins: [atriumModules(), tailwindcss(), sveltekit()],
	test: {
		include: [
			'tests/unit/**/*.test.ts',
			'tests/integration/**/*.test.ts',
			'src/**/*.test.ts',
			`${MODULES}/*/tests/**/*.test.ts`
		],
		environment: 'node',
		setupFiles: ['tests/setup.ts'],
		testTimeout: 30000,
		// PGlite-Setups (Migrationen, Module) brauchen unter paralleler Last mehr als 10 s
		hookTimeout: 60000,
		// `npx vitest run --coverage` (CI): Bericht in coverage/ (lcov) + Kurzfassung im Log
		coverage: {
			provider: 'v8',
			reporter: ['text-summary', 'lcov'],
			reportsDirectory: 'coverage',
			// Bericht auch bei roten Tests (CI-Artefakt)
			reportOnFailure: true,
			include: ['src/lib/**/*.ts', `${MODULES}/**/*.ts`],
			exclude: ['src/lib/**/*.d.ts', 'src/lib/**/*.test.ts', `${MODULES}/*/tests/**`],
			// Startschwellen (Messung 2026-10-20: Zeilen 89 %, Anweisungen 87 %, Funktionen 88 %,
			// Zweige 77 %) – mit Puffer; schrittweise anheben
			thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 }
		}
	}
});
