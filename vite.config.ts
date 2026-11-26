import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { atriumModules } from './tools/vite-plugin-atrium-modules.ts';

// Tests laufen mit `bun test` (Konfiguration in bunfig.toml → [test], Preload tests/bun/preload.ts)
export default defineConfig({
	plugins: [atriumModules(), tailwindcss(), sveltekit()]
});
