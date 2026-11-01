/**
 * Vite-Plugin: bindet die installierten Fachmodule aus `modulesDir()` ein (statt fester
 * `import.meta.glob`-Pfade unter `src/`).
 *
 * - `virtual:atrium-modules/server` – statische Importe aller `module.ts` (nur SSR), Export `entries`
 *   (`folder`, `definition`, `migrationFiles` = Namen der `migrations/*.sql` für die Konventionsprüfung)
 * - `virtual:atrium-modules/ui` – Lazy-Loader aller `ui.ts`, Export `uiLoaders`, `moduleIds`
 * - Tailwind: `@source "<modulesDir>"` in `src/app.css`, damit Klassen auch aus einem Ordner außerhalb
 *   des Projekts oder aus einem gitignorierten Ordner erzeugt werden
 * - Dev: neue/entfernte Module lösen ein volles Neuladen aus
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { CORE_ROOT, moduleIds, modulesDir } from './modules-dir.js';

const SERVER_ID = 'virtual:atrium-modules/server';
const UI_ID = 'virtual:atrium-modules/ui';
const RESOLVED_SERVER = '\0' + SERVER_ID;
const RESOLVED_UI = '\0' + UI_ID;

function serverSource(dir: string): string {
	const ids = moduleIds(dir);
	const imports = ids.map(
		(id, i) => `import m${i} from ${JSON.stringify(`${dir}/${id}/module.ts`)};`
	);
	const entries = ids.map((id, i) => {
		const migDir = join(dir, id, 'migrations');
		const files = existsSync(migDir)
			? readdirSync(migDir)
					.filter((f) => f.endsWith('.sql'))
					.map((f) => f.slice(0, -4))
					.sort()
			: [];
		return `	{ folder: ${JSON.stringify(id)}, definition: m${i}, migrationFiles: ${JSON.stringify(files)} }`;
	});
	return [...imports, `export const entries = [\n${entries.join(',\n')}\n];`].join('\n');
}

/**
 * npm-Pakete aus `atrium-module.json` → `npm`, die der Core nicht selbst mitbringt (die liegen in
 * `<modulesDir>/node_modules` und müssen gebündelt werden, weil der Server-Build dort nicht sucht).
 */
export function modulePackages(dir: string): string[] {
	const core = JSON.parse(readFileSync(join(CORE_ROOT, 'package.json'), 'utf8')) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	const known = new Set([
		...Object.keys(core.dependencies ?? {}),
		...Object.keys(core.devDependencies ?? {})
	]);
	const out = new Set<string>();
	for (const id of moduleIds(dir)) {
		const file = join(dir, id, 'atrium-module.json');
		if (!existsSync(file)) continue;
		try {
			const pkg = JSON.parse(readFileSync(file, 'utf8')) as { npm?: Record<string, string> };
			for (const name of Object.keys(pkg.npm ?? {})) if (!known.has(name)) out.add(name);
		} catch {
			// ungültiges Paket meldet der Lader beim Start („Defekt“)
		}
	}
	return [...out].sort();
}

function uiSource(dir: string): string {
	const ids = moduleIds(dir).filter((id) => existsSync(join(dir, id, 'ui.ts')));
	const entries = ids.map(
		(id) => `\t${JSON.stringify(id)}: () => import(${JSON.stringify(`${dir}/${id}/ui.ts`)})`
	);
	return [
		`export const uiLoaders = {\n${entries.join(',\n')}\n};`,
		`export const moduleIds = ${JSON.stringify(ids)};`
	].join('\n');
}

export function atriumModules(): Plugin {
	const dir = modulesDir();
	let server: ViteDevServer | undefined;

	function invalidate() {
		if (!server) return;
		for (const id of [RESOLVED_SERVER, RESOLVED_UI]) {
			const mod = server.moduleGraph.getModuleById(id);
			if (mod) server.moduleGraph.invalidateModule(mod);
		}
		server.ws.send({ type: 'full-reload' });
	}

	return {
		name: 'atrium-modules',
		enforce: 'pre',
		config() {
			const cacheDir = process.env.ATRIUM_VITE_CACHE?.trim();
			return {
				server: { fs: { allow: [dir] } },
				// Modulspezifische npm-Pakete liegen neben den Modulen (nicht im Core): ins Server-Bundle aufnehmen
				ssr: { noExternal: modulePackages(dir) },
				...(cacheDir ? { cacheDir } : {})
			};
		},
		resolveId(id) {
			if (id === SERVER_ID) return RESOLVED_SERVER;
			if (id === UI_ID) return RESOLVED_UI;
		},
		load(id, opts) {
			if (id === RESOLVED_SERVER) {
				if (!opts?.ssr) throw new Error(`${SERVER_ID} ist nur auf dem Server verfügbar`);
				return serverSource(dir);
			}
			if (id === RESOLVED_UI) return uiSource(dir);
		},
		transform(code, id) {
			if (!/[\\/]src[\\/]app\.css(\?|$)/.test(id)) return;
			return { code: `${code}\n@source ${JSON.stringify(dir)};\n`, map: null };
		},
		configureServer(dev) {
			server = dev;
			dev.watcher.add(dir);
			const onChange = (file: string) => {
				const f = file.replace(/\\/g, '/');
				if (
					f.startsWith(dir + '/') &&
					/\/[^/]+\/(module|ui)\.ts$|\/migrations\/[^/]+\.sql$/.test(f.slice(dir.length))
				)
					invalidate();
			};
			dev.watcher.on('add', onChange);
			dev.watcher.on('unlink', onChange);
		}
	};
}
