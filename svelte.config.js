import adapter from '@sveltejs/adapter-node';
import { relative } from 'node:path';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { CORE_ROOT, modulesDir } from './tools/modules-dir.js';

// Installierte Fachmodule (Standard `modules/`, sonst ATRIUM_MODULES_DIR) – siehe tools/modules-dir.js
const MODULES = modulesDir();
// Supervisor-Neubau (Kalypzo Atrium): Ausgabe und Arbeitsordner außerhalb des (schreibgeschützten) Core-Ordners
const KIT_OUT = process.env.ATRIUM_KIT_OUT_DIR?.trim() || `${CORE_ROOT}/.svelte-kit`;
const BUILD_OUT = process.env.ATRIUM_BUILD_OUT?.trim() || 'build';
const fromKit = relative(KIT_OUT, MODULES).replace(/\\/g, '/');
const toolsFromKit = relative(KIT_OUT, `${CORE_ROOT}/tools`).replace(/\\/g, '/');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: { runes: true },
	kit: {
		adapter: adapter({ out: BUILD_OUT }),
		outDir: KIT_OUT,
		alias: { $modules: MODULES, $testing: `${CORE_ROOT}/tests/sdk` },
		typescript: {
			config(cfg) {
				cfg.include.push(`${fromKit}/**/*.ts`, `${fromKit}/**/*.svelte`, `${toolsFromKit}/**/*.ts`);
				// SvelteKit schreibt Alias-Pfade relativ („./C:/…“ bei anderem Laufwerk) – absolut ist immer gültig
				cfg.compilerOptions.paths.$modules = [MODULES];
				cfg.compilerOptions.paths['$modules/*'] = [`${MODULES}/*`];
			}
		},
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self', 'data:'],
				'connect-src': ['self'],
				'worker-src': ['self'],
				'manifest-src': ['self'],
				'frame-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
