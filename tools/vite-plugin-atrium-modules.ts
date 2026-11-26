/**
 * Vite-Plugin: bindet die installierten Fachmodule aus `modulesDir()` ein (statt fester
 * `import.meta.glob`-Pfade unter `src/`).
 *
 * - `virtual:atrium-modules/server` – Lazy-Importe aller `module.ts` (nur SSR), Export `entries`
 *   (`folder`, `load`, `migrationFiles` = Namen der `migrations/*.sql` für die Konventionsprüfung)
 * - `virtual:atrium-host/{client,server}` – Host-Registry für separat kompilierte Modul-Bundles
 *   (`tools/host-abi.js`, `$lib/host/registry.ts`): Lazy-Loader je geteiltem Paket bzw. freigegebener
 *   `$lib`-Datei, Export `abi`
 * - `virtual:atrium-modules/ui` – Lazy-Loader aller `ui.ts`, Export `uiLoaders`, `moduleIds`
 * - `virtual:atrium-core/{messages,pdf-templates,fonts}` – Core-Texte und Briefvorlagen (`tools/core-virtual.ts`)
 * - `virtual:atrium-modules/messages` – Texte der Module (`messages/<sprache>.json`), Export default
 *   `{ <id>: { <sprache>: {…} } }` für `$lib/i18n`
 * - Tailwind: `@source "<modulesDir>"` in `src/app.css`, damit Klassen auch aus einem Ordner außerhalb
 *   des Projekts oder aus einem gitignorierten Ordner erzeugt werden
 * - Dev: neue/entfernte Module lösen ein volles Neuladen aus
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import {
	CORE_MESSAGES_ID,
	FONTS_ID,
	PDF_TEMPLATES_ID,
	coreMessagesSource,
	fontsSource,
	pdfTemplatesSource
} from './core-virtual.ts';
import { LIB_DIR, hostAbiHash, hostGroupedEntries } from './host-abi.js';
import { CORE_ROOT, moduleIds, modulesDir } from './modules-dir.js';

const SERVER_ID = 'virtual:atrium-modules/server';
const UI_ID = 'virtual:atrium-modules/ui';
const RESOLVED_SERVER = '\0' + SERVER_ID;
const RESOLVED_UI = '\0' + UI_ID;
const MESSAGES_ID = 'virtual:atrium-modules/messages';
const RESOLVED_MESSAGES = '\0' + MESSAGES_ID;
const MESSAGE_FILE = /^([a-z]{2})\.json$/;

/** Texte aller Module als JSON-Literal (ungültige Dateien brechen den Build mit klarer Meldung ab). */
export function messagesSource(dir: string): string {
	const out: Record<string, Record<string, unknown>> = {};
	for (const id of moduleIds(dir)) {
		const msgDir = join(dir, id, 'messages');
		if (!existsSync(msgDir)) continue;
		for (const f of readdirSync(msgDir).sort()) {
			const m = MESSAGE_FILE.exec(f);
			if (!m) continue;
			try {
				(out[id] ??= {})[m[1]!] = JSON.parse(readFileSync(join(msgDir, f), 'utf8'));
			} catch (e) {
				throw new Error(`Modul ${id}: messages/${f} ist kein gültiges JSON (${String(e)})`, {
					cause: e
				});
			}
		}
	}
	return `export default ${JSON.stringify(out)};`;
}

/**
 * Je Modul ein Lazy-Import (eigener SSR-Chunk): Scheitert der Import eines Moduls – etwa weil ein npm-Paket
 * fehlt –, markiert der Lader nur dieses Modul als defekt, statt dass der ganze Server-Start abbricht.
 */
export function serverSource(dir: string): string {
	const entries = moduleIds(dir).map((id) => {
		const migDir = join(dir, id, 'migrations');
		const files = existsSync(migDir)
			? readdirSync(migDir)
					.filter((f) => f.endsWith('.sql'))
					.map((f) => f.slice(0, -4))
					.sort()
			: [];
		const file = JSON.stringify(`${dir}/${id}/module.ts`);
		return `	{ folder: ${JSON.stringify(id)}, load: () => import(${file}), migrationFiles: ${JSON.stringify(files)} }`;
	});
	return `export const entries = [\n${entries.join(',\n')}\n];`;
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

type HostSide = 'client' | 'server';
const hostMapId = (side: HostSide) => `virtual:atrium-host-map/${side}`;
const hostGroupId = (side: HostSide, group: string) => `virtual:atrium-host-group/${side}/${group}`;

/** Host-Registry einer Seite (klein, im Einstieg): Loader-Liste wird erst beim ersten `preload` geladen */
export function hostSource(side: HostSide): string {
	return [
		`import { installHost } from ${JSON.stringify(`${LIB_DIR}/host/registry.ts`)};`,
		`export const abi = ${JSON.stringify(hostAbiHash())};`,
		`export const host = installHost(() => import(${JSON.stringify(hostMapId(side))}).then((m) => m.loaders), abi);`
	].join('\n');
}

/** Loader-Liste: jeder Schlüssel lädt seine Gruppe (ein Chunk je Gruppe) und nimmt daraus seinen Namespace */
export function hostMapSource(side: HostSide): string {
	const lines: string[] = [];
	for (const [group, entries] of hostGroupedEntries(side)) {
		const id = JSON.stringify(hostGroupId(side, group));
		entries.forEach(({ key }, i) =>
			lines.push(`\t${JSON.stringify(key)}: () => import(${id}).then((g) => g.f${i})`)
		);
	}
	return `export const loaders = {\n${lines.join(',\n')}\n};`;
}

/** Gruppenmodul: Namespaces aller Einträge der Gruppe (`export * as fN`, gleiche Instanzen wie im Core) */
export function hostGroupSource(side: HostSide, group: string): string | null {
	const entries = hostGroupedEntries(side).get(group);
	if (!entries) return null;
	return entries
		.map(({ target }, i) => `export * as f${i} from ${JSON.stringify(target)};`)
		.join('\n');
}

/** Alle virtuellen Host-Module (für den Bun-Testlauf, der Kennungen einzeln anmelden muss) */
export function hostVirtualSources(): Record<string, () => string> {
	const out: Record<string, () => string> = {};
	for (const side of ['client', 'server'] as const) {
		out[`virtual:atrium-host/${side}`] = () => hostSource(side);
		out[hostMapId(side)] = () => hostMapSource(side);
		for (const group of hostGroupedEntries(side).keys())
			out[hostGroupId(side, group)] = () => hostGroupSource(side, group) ?? '';
	}
	return out;
}

/** Kennung eines virtuellen Host-Moduls → Quelltext (oder `undefined`, wenn keins) */
function hostVirtualLoad(id: string, ssr: boolean): string | undefined {
	const m = /^virtual:atrium-host(?:-(map|group))?\/(client|server)(?:\/(.+))?$/.exec(id);
	if (!m) return undefined;
	const [, kind, side, group] = m as unknown as [string, string | undefined, HostSide, string?];
	if (side === 'server' && !ssr) throw new Error(`${id} ist nur auf dem Server verfügbar`);
	if (kind === 'map') return hostMapSource(side);
	if (kind === 'group') return hostGroupSource(side, group ?? '') ?? undefined;
	return hostSource(side);
}

export function uiSource(dir: string): string {
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
		for (const id of [RESOLVED_SERVER, RESOLVED_UI, RESOLVED_MESSAGES]) {
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
			if (id === MESSAGES_ID) return RESOLVED_MESSAGES;
			if (id.startsWith('virtual:atrium-host')) return '\0' + id;
			if (id === CORE_MESSAGES_ID || id === PDF_TEMPLATES_ID || id === FONTS_ID) return '\0' + id;
		},
		load(id, opts) {
			if (id === RESOLVED_SERVER) {
				if (!opts?.ssr) throw new Error(`${SERVER_ID} ist nur auf dem Server verfügbar`);
				return serverSource(dir);
			}
			if (id === RESOLVED_UI) return uiSource(dir);
			if (id.startsWith('\0virtual:atrium-host')) {
				const source = hostVirtualLoad(id.slice(1), Boolean(opts?.ssr));
				if (source === undefined) throw new Error(`Unbekanntes Host-Modul: ${id.slice(1)}`);
				return source;
			}
			if (id === RESOLVED_MESSAGES) return messagesSource(dir);
			if (id === '\0' + CORE_MESSAGES_ID) return coreMessagesSource();
			if (id === '\0' + PDF_TEMPLATES_ID) return pdfTemplatesSource();
			if (id === '\0' + FONTS_ID) return fontsSource();
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
					/\/[^/]+\/(module|ui)\.ts$|\/migrations\/[^/]+\.sql$|\/messages\/[a-z]{2}\.json$/.test(
						f.slice(dir.length)
					)
				)
					invalidate();
			};
			dev.watcher.on('add', onChange);
			dev.watcher.on('unlink', onChange);
			dev.watcher.on('change', (file) => {
				if (/[\\/]messages[\\/][a-z]{2}\.json$/.test(file)) onChange(file);
			});
		}
	};
}
