/**
 * Preload für `bun test` (eingetragen in `bunfig.toml` → `[test] preload`).
 *
 * Ersetzt, was unter Vitest das Vite-/SvelteKit-Plugin geleistet hat – ausschließlich über virtuelle Module
 * (`build.module`), weil Bun unter Windows `onLoad`/`onResolve` für JS/TS nicht auf allen Laufwerken aufruft:
 * - `virtual:atrium-modules/{server,ui,messages}` und `virtual:atrium-core/{messages,pdf-templates,fonts}` → dieselben
 *   Generatoren wie im Vite-Plugin (`tools/vite-plugin-atrium-modules.ts`, `tools/core-virtual.ts`)
 * - `$app/*` → `tests/bun/app-stubs.ts` (kein SvelteKit-Laufzeitkontext im Test)
 * - Schutz vor gefährlichem rekursivem Löschen (`tests/bun/fs-guard.ts`), Hook-Zeitlimit 60 s (`hook-timeout.ts`)
 * - Testumgebung (früher `tests/setup.ts`)
 *
 * Nicht hier: Aliase `$lib`, `$testing`, `$modules` löst Bun über `paths` aus `.svelte-kit/tsconfig.json` auf
 * (deshalb läuft vor den Tests `svelte-kit sync`, siehe `package.json`); `…?raw` kann Bun selbst.
 */
// Zuerst: Schutz vor rekursivem Löschen von Arbeitsverzeichnis/Projekt (siehe fs-guard.ts)
import './fs-guard';
import './hook-timeout';
import { plugin } from 'bun';
import { join } from 'node:path';
import {
	CORE_MESSAGES_ID,
	FONTS_ID,
	PDF_TEMPLATES_ID,
	coreMessagesSource,
	fontsSource,
	pdfTemplatesSource
} from '../../tools/core-virtual.ts';
import { CORE_ROOT, modulesDir } from '../../tools/modules-dir.js';
import { messagesSource, serverSource, uiSource } from '../../tools/vite-plugin-atrium-modules.ts';

process.env.APP_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.ORIGIN = 'http://localhost:5173';
process.env.DATABASE_URL = 'postgres://unused/unused';
process.env.DATABASE_DRIVER = 'pglite';
// Kennzeichen für Testläufe (Name aus der Vitest-Zeit, Bestandscode fragt ihn ab)
process.env.VITEST = 'true';

const MODULES = modulesDir();
const APP_STUBS = JSON.stringify(
	join(CORE_ROOT, 'tests', 'bun', 'app-stubs.ts').replace(/\\/g, '/')
);
const APP_MODULES = ['server', 'environment', 'navigation', 'forms', 'state', 'paths'];

plugin({
	name: 'atrium-bun-test',
	setup(build) {
		const virtual: Record<string, () => string> = {
			'virtual:atrium-modules/server': () => serverSource(MODULES),
			'virtual:atrium-modules/ui': () => uiSource(MODULES),
			'virtual:atrium-modules/messages': () => messagesSource(MODULES),
			[CORE_MESSAGES_ID]: coreMessagesSource,
			[PDF_TEMPLATES_ID]: pdfTemplatesSource,
			[FONTS_ID]: fontsSource
		};
		for (const [id, source] of Object.entries(virtual)) {
			build.module(id, () => ({ contents: source(), loader: 'js' }));
		}
		for (const name of APP_MODULES) {
			build.module(`$app/${name}`, () => ({
				contents: `export * from ${APP_STUBS};`,
				loader: 'js'
			}));
		}
	}
});
