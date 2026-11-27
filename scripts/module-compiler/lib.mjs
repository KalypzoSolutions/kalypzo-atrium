// @ts-check
/**
 * Modul-Compiler (Umbau „Module ohne App-Neubau“, Phase 2): übersetzt **ein** Fachmodul einzeln in vorkompilierte
 * Bundles, die der Core zur Laufzeit lädt – statt das Modul in einen kompletten App-Build hineinzukompilieren.
 *
 * Ausgabe in `outDir`:
 *   server/module.js  – `module.ts` (Default-Export = Moduldefinition), SSR, alles außer der Host-ABI gebündelt
 *   server/ui.js      – `ui.ts` für das Server-Rendering der Modulseiten (falls vorhanden)
 *   client/ui.js      – `ui.ts` für den Browser (Seiten als eigene Chunks), registriert die Modultexte
 *   client/module.css – `<style>`-Blöcke seiner Svelte-Komponenten (Tailwind-Klassen: `meta.client.tailwind`,
 *                       daraus baut die App ein gemeinsames Utilities-CSS)
 *   meta.json         – Kennungen (Inhalt, ABI), Einstiege, vorzuladende Host-Schlüssel je Seite, Migrationen
 *
 * Geteilt (nicht gebündelt) wird die Host-ABI aus `tools/host-abi.js`; Importe darauf werden in Zugriffe auf
 * `globalThis.__atriumHost` umgeschrieben (`rewrite.mjs`). Eigene npm-Pakete (`atrium-module.json` → `npm`) werden
 * installiert und ins Bundle aufgenommen; alles andere löst sich aus den Paketen des Core auf und wird ebenfalls
 * gebündelt. Läuft als eigener Prozess (`compile.mjs`), schreibt nur in `outDir`.
 */
import { spawn } from 'node:child_process';
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmdirSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { build } from 'vite';
import {
	CLIENT_PACKAGE_TARGETS,
	HOST_PACKAGES,
	LIB_DIR,
	allowedLibFiles,
	hostAbiHash,
	hostLibFiles
} from '../../tools/host-abi.js';
import { CORE_ROOT } from '../../tools/modules-dir.js';
import { contentHashOfDir } from '../supervisor/lib.mjs';
import { HOST_PREFIX, rewriteHostImports } from './rewrite.mjs';

export const COMPILE_PREFIX = 'ATRIUM_COMPILE ';
export const META_FILE = 'meta.json';
export const META_VERSION = 1;

const norm = (/** @type {string} */ p) => p.replace(/\\/g, '/');
const MESSAGE_FILE = /^([a-z]{2})\.json$/;

/** Fehler beim Kompilieren mit Art (für die Anzeige als „Defekt“) */
export class CompileError extends Error {
	/**
	 * @param {string} message
	 * @param {{ kind: 'missingPackage' | 'forbiddenImport' | 'invalidModule' | 'build', name?: string }} info
	 */
	constructor(message, info) {
		super(message);
		this.kind = info.kind;
		this.packageName = info.name ?? null;
	}
}

/**
 * Fehlendes Paket aus einer Rolldown-/Vite-Meldung („failed to resolve import "x" from …“, „Could not resolve 'x'“)
 * @param {string} message
 */
export function unresolvedPackage(message) {
	const m =
		/failed to resolve import ["']([^"']+)["']/i.exec(message) ??
		/Could not resolve ["']([^"']+)["']/i.exec(message);
	const spec = m?.[1];
	if (!spec || /^(\.|\/|[a-zA-Z]:[\\/]|\$|\0|virtual:)/.test(spec)) return null;
	const parts = spec.split('/');
	return spec.startsWith('@') ? parts.slice(0, 2).join('/') : /** @type {string} */ (parts[0]);
}

/**
 * Vite-Plugin für eine Seite: Host-ABI → extern (`atrium-host:<schlüssel>`), Grenzen der Module prüfen,
 * nach dem Bündeln die Host-Importe umschreiben und die benötigten Schlüssel sammeln.
 * @param {'client' | 'server'} side
 * @param {{ moduleDir: string, used: Map<string, Set<string>> }} ctx
 * @returns {import('vite').Plugin}
 */
export function hostPlugin(side, ctx) {
	const packages = new Set(HOST_PACKAGES[side]);
	const shared = new Set(hostLibFiles(side));
	const allowed = new Set(allowedLibFiles());
	const roots = [...packages].map((p) => (p.startsWith('$') ? p : p.split('/')[0]));
	const external = (/** @type {string} */ key) => ({ id: `${HOST_PREFIX}${key}`, external: true });
	const libFile = (/** @type {string} */ id) => {
		const f = norm(id).split('?')[0] ?? '';
		return f.startsWith(`${LIB_DIR}/`) ? f.slice(LIB_DIR.length + 1) : null;
	};
	return {
		name: 'atrium-host',
		enforce: 'pre',
		async resolveId(source, importer, opts) {
			if (source.startsWith(HOST_PREFIX)) return { id: source, external: true };
			if (packages.has(source)) return external(source);
			// Unterpfade geteilter Pakete, die nicht selbst geteilt sind (svelte/compiler, drizzle-orm/pg-core …)
			const root = source.startsWith('@')
				? source.split('/').slice(0, 2).join('/')
				: source.startsWith('$app/')
					? '$app'
					: source.split('/')[0];
			if (
				roots.includes(/** @type {string} */ (root)) &&
				root !== source &&
				!packages.has(source)
			) {
				if (side === 'client' && root === 'zod') return null; // zod wird im Browser gebündelt
				throw new CompileError(`„${source}“ ist nicht Teil der Host-ABI (${side})`, {
					kind: 'forbiddenImport'
				});
			}
			if (
				source === '$app' ||
				(source.startsWith('$') && !source.startsWith('$lib') && !source.startsWith('$modules'))
			)
				throw new CompileError(`„${source}“ ist für Module nicht verfügbar`, {
					kind: 'forbiddenImport'
				});
			const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
			if (!r || r.external) return r;
			const rel = libFile(r.id);
			if (rel !== null) {
				if (shared.has(rel)) return external(`lib:${rel}`);
				if (rel.startsWith('server/') || rel.startsWith('host/registry'))
					throw new CompileError(`„$lib/${rel}“ ist für Module nicht freigegeben`, {
						kind: 'forbiddenImport'
					});
				// Module selbst nur in den freigegebenen Bereichen; Core-Dateien und die vom Compiler erzeugten Einstiege
				// (`\0atrium-…`) dürfen untereinander alles (Kopien im Browser)
				const fromModule =
					!importer || (!importer.startsWith('\0atrium-') && libFile(importer) === null);
				if (fromModule && !allowed.has(rel))
					throw new CompileError(`„$lib/${rel}“ ist für Module nicht freigegeben`, {
						kind: 'forbiddenImport'
					});
				if (side === 'server')
					throw new CompileError(`„$lib/${rel}“ ist auf dem Server nicht Teil der Host-ABI`, {
						kind: 'forbiddenImport'
					});
			}
			if (/\/node_modules\/svelte\//.test(norm(r.id)))
				throw new CompileError(`Svelte-Interna („${source}“) müssen aus der Host-ABI kommen`, {
					kind: 'forbiddenImport'
				});
			return r;
		},
		renderChunk(code) {
			const { code: out, used } = rewriteHostImports(code);
			for (const [k, names] of used) {
				const set = ctx.used.get(k) ?? new Set();
				for (const n of names) set.add(n);
				ctx.used.set(k, set);
			}
			return { code: out, map: null };
		}
	};
}

/**
 * Browser-Einstieg: registriert die Modultexte im (geteilten) i18n-Katalog des Core, stellt `zod` auf die Texte
 * des Core ein (die gebündelte Kopie, nur wenn das Modul zod nutzt – `zod` → Wrapper) und reicht `ui.ts` durch.
 * @param {{ id: string, workModule: string, hasUi: boolean }} o
 * @returns {import('vite').Plugin}
 */
function clientEntryPlugin(o) {
	const ENTRY = '\0atrium-entry-client';
	const ZOD = '\0atrium-zod';
	const zodLocale = `${LIB_DIR}/zod-locale.ts`;
	return {
		name: 'atrium-client-entry',
		enforce: 'pre',
		async resolveId(source, importer) {
			if (source === ENTRY) return ENTRY;
			// zod im Browser: über einen Wrapper, der die Texte des Core aktiviert (zod-locale selbst nimmt echtes zod)
			if (source === 'zod' && importer !== ZOD && norm(importer ?? '') !== zodLocale) return ZOD;
			return null;
		},
		async load(id) {
			if (id === ZOD) {
				const real = await this.resolve('zod', zodLocale, { skipSelf: true });
				const target = JSON.stringify(real?.id ?? 'zod');
				// Gemessen (events): der Wrapper kostet ~4 KB; die ~250 KB zod selbst braucht das Modul für seine Schemas
				// im Browser (klassische zod-API ist kaum tree-shakebar). zod zu teilen würde jede Core-Seite +278 KB kosten.
				return `import ${JSON.stringify(zodLocale)};\nexport * from ${target};\nexport { default } from ${target};`;
			}
			if (id !== ENTRY) return null;
			const lines = [`import { addMessages } from ${JSON.stringify(`${LIB_DIR}/i18n/index.ts`)};`];
			const msgDir = join(o.workModule, 'messages');
			if (existsSync(msgDir)) {
				for (const f of readdirSync(msgDir).sort()) {
					const m = MESSAGE_FILE.exec(f);
					if (!m) continue;
					const v = `messages_${m[1]}`;
					lines.push(`import ${v} from ${JSON.stringify(norm(join(msgDir, f)))};`);
					lines.push(`addMessages(${JSON.stringify(o.id)}, ${JSON.stringify(m[1])}, ${v});`);
				}
			}
			lines.push(
				o.hasUi
					? `export { default } from ${JSON.stringify(norm(join(o.workModule, 'ui.ts')))};`
					: 'export default {};'
			);
			return lines.join('\n');
		}
	};
}

/**
 * Dateien in `<dir>/assets`, die kein JS/CSS des Bundles erwähnt (Vite legt per `new URL(…)` gefundene Dateien auch
 * dann ab, wenn der Code dazu weggeschüttelt wurde – z. B. die 900-KB-WebAssembly des Barcode-Scanners).
 * @param {string} dir
 */
function removeUnreferencedAssets(dir) {
	const assets = join(dir, 'assets');
	if (!existsSync(assets)) return;
	/** @type {string[]} */
	const texts = [];
	const walk = (/** @type {string} */ d) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (lstatSync(p).isDirectory()) walk(p);
			else if (/\.(js|css)$/.test(name)) texts.push(readFileSync(p, 'utf8'));
		}
	};
	walk(dir);
	const all = texts.join('\n');
	for (const name of readdirSync(assets)) if (!all.includes(name)) rmSync(join(assets, name));
	if (!readdirSync(assets).length) rmdirSync(assets);
}

/** Junctions/Symlinks entfernen, ohne ihnen zu folgen (sonst löscht rmSync den Inhalt des Ziels) */
function removeLinks(/** @type {string} */ dir) {
	if (!existsSync(dir)) return;
	const st = lstatSync(dir);
	if (st.isSymbolicLink()) {
		try {
			unlinkSync(dir);
		} catch {
			rmdirSync(dir);
		}
		return;
	}
	if (!st.isDirectory()) return;
	for (const name of readdirSync(dir)) removeLinks(join(dir, name));
}

/** Arbeitsordner sicher löschen */
export function removeWorkDir(/** @type {string} */ dir) {
	removeLinks(dir);
	rmSync(dir, { recursive: true, force: true });
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd: string, log: (line: string) => void }} o
 */
function run(cmd, args, o) {
	return new Promise((ok, fail) => {
		const p = spawn(cmd, args, { cwd: o.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
		p.stdout.on('data', (d) => o.log(String(d).trimEnd()));
		p.stderr.on('data', (d) => o.log(String(d).trimEnd()));
		p.on('error', fail);
		p.on('exit', (code) =>
			code === 0 ? ok(undefined) : fail(new Error(`${cmd} endete mit Code ${code}`))
		);
	});
}

const pureCache = new Map();
/**
 * Darf eine Core-Datei weggelassen werden, wenn das Modul nichts aus ihr nutzt? Nur Svelte-Komponenten und reine
 * Sammel-Exporte (`index.ts` mit ausschließlich `export … from`/`import type`): Sonst bündelt `import { PageHeader }
 * from '$lib/components/layout'` den ganzen Bereich mit (Rich-Text-Editor, Barcode-Scanner …). Dateien mit echten
 * Seiteneffekten (z. B. Registrierungen beim Import) bleiben unberührt.
 * @param {string} id
 */
export function coreFileIsPure(id) {
	const file = norm(id).split('?')[0] ?? '';
	if (!file.startsWith(`${LIB_DIR}/`)) return false;
	if (file.endsWith('.svelte')) return true;
	if (!/\.(ts|js)$/.test(file)) return false;
	let pure = pureCache.get(file);
	if (pure === undefined) {
		const code = readFileSync(file, 'utf8')
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/^\s*\/\/.*$/gm, '');
		// nur Import-/Export-Deklarationen mit Bindungen (auch mehrzeilig) – kein nacktes `import 'x'` (= Seiteneffekt)
		const SRC = String.raw`\s+from\s+['"][^'"]+['"]`;
		const BIND = String.raw`(\w+\s*,\s*)?(\{[^}]*\}|\*\s+as\s+\w+|\w+)`;
		const STATEMENT = [
			String.raw`import\s+(type\s+)?${BIND}${SRC}`,
			String.raw`export\s+(type\s+)?(\*|\*\s+as\s+\w+|\{[^}]*\})${SRC}`,
			String.raw`export\s+(type\s+)?\{[^}]*\}`
		].join('|');
		pure = new RegExp(String.raw`^(\s*(${STATEMENT})\s*;?)*\s*$`).test(code);
		pureCache.set(file, pure);
	}
	return pure;
}

/**
 * Paketnamen eines `node_modules`-Ordners (inkl. `@scope/name`), sortiert.
 * @param {string} nodeModules
 * @returns {string[]}
 */
export function installedPackageNames(nodeModules) {
	if (!existsSync(nodeModules)) return [];
	/** @type {string[]} */
	const out = [];
	for (const name of readdirSync(nodeModules)) {
		if (name.startsWith('.')) continue;
		if (name.startsWith('@')) {
			for (const sub of readdirSync(join(nodeModules, name))) out.push(`${name}/${sub}`);
		} else out.push(name);
	}
	return out.sort();
}

/**
 * Gemeinsame Vite-Konfiguration einer Seite. `dedupe`: Pakete, die für das Modul installiert wurden – sie gelten im
 * ganzen Bundle, auch für Importe aus Core-Paketen heraus. Sonst bündelt z. B. `notes` zwei ProseMirror-Kopien
 * (`@tiptap/pm` als Peer der eigenen tiptap-Erweiterungen + die des Core über `@tiptap/starter-kit`) und der Editor
 * scheitert mit „Adding different instances of a keyed plugin“.
 * @param {'client' | 'server'} side
 * @param {{ workModule: string, outDir: string, cacheDir: string, input: Record<string, string>, used: Map<string, Set<string>>, extra?: import('vite').Plugin[], keepOutDir?: boolean, dedupe?: string[] }} o
 * @returns {import('vite').InlineConfig}
 */
function viteConfig(side, o) {
	return {
		configFile: false,
		root: o.workModule,
		base: './',
		logLevel: 'warn',
		cacheDir: o.cacheDir,
		publicDir: false,
		clearScreen: false,
		mode: 'production',
		resolve: {
			alias: [{ find: /^\$lib(?=\/|$)/, replacement: LIB_DIR }],
			dedupe: o.dedupe ?? []
		},
		define: { 'import.meta.env.SSR': JSON.stringify(side === 'server') },
		plugins: [
			hostPlugin(side, { moduleDir: o.workModule, used: o.used }),
			...(o.extra ?? []),
			svelte({
				configFile: false,
				preprocess: vitePreprocess(),
				compilerOptions: { runes: true },
				emitCss: side === 'client'
			})
		],
		ssr: side === 'server' ? { noExternal: true, target: 'node' } : undefined,
		build: {
			outDir: join(o.outDir, side),
			emptyOutDir: !o.keepOutDir,
			ssr: side === 'server',
			target: 'es2022',
			minify: side === 'client',
			sourcemap: false,
			cssCodeSplit: false,
			modulePreload: false,
			copyPublicDir: false,
			reportCompressedSize: false,
			rollupOptions: {
				input: o.input,
				preserveEntrySignatures: 'strict',
				treeshake: { moduleSideEffects: (id) => !coreFileIsPure(id) },
				output: {
					format: 'es',
					entryFileNames: '[name].js',
					chunkFileNames: 'chunks/[name]-[hash].js',
					assetFileNames: 'assets/[name]-[hash][extname]'
				}
			}
		}
	};
}

/**
 * Tailwind-Kandidaten (mögliche Klassennamen) eines Modulordners. Das Modul bringt **kein** eigenes Utilities-CSS
 * mit: Kleine Teil-Stylesheets können die globale Reihenfolge von Tailwind nicht abbilden (gemessen: `sm:left-3` aus
 * dem Modul verlor gegen `left-1/2` des Core, eine doppelte `.p-0` schlug `md:p-8` des Core). Die App baut daraus ein
 * gemeinsames Utilities-CSS aus Core + allen aktiven Modulen (`core/modules/bundles/utilities.ts`).
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function tailwindCandidates(dir) {
	const { Scanner } = await import('@tailwindcss/oxide');
	return [
		...new Set(
			new Scanner({ sources: [{ base: norm(dir), pattern: '**/*', negated: false }] }).scan()
		)
	].sort();
}

/**
 * Ein Modul kompilieren.
 * @param {{ moduleDir: string, outDir: string, log?: (line: string) => void, installPackages?: boolean }} opts
 * @returns {Promise<Record<string, any>>} Inhalt von `meta.json`
 */
export async function compileModule(opts) {
	const log = opts.log ?? (() => {});
	const moduleDir = resolve(opts.moduleDir);
	const outDir = resolve(opts.outDir);
	const pkgFile = join(moduleDir, 'atrium-module.json');
	if (!existsSync(join(moduleDir, 'module.ts')) || !existsSync(pkgFile))
		throw new CompileError(`${moduleDir}: module.ts oder atrium-module.json fehlt`, {
			kind: 'invalidModule'
		});
	const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
	const id = String(pkg.id ?? '');
	if (id !== basename(moduleDir))
		throw new CompileError(`Ordner „${basename(moduleDir)}“ ≠ Modul-ID „${id}“`, {
			kind: 'invalidModule'
		});
	const contentHash = contentHashOfDir(moduleDir);
	const abi = hostAbiHash();

	// Arbeitsordner: <out>/.work/modules/<id> (Kopie), …/modules/node_modules (eigene Pakete), …/node_modules → Core
	removeWorkDir(outDir);
	const work = join(outDir, '.work');
	const workModules = join(work, 'modules');
	const workModule = join(workModules, id);
	mkdirSync(workModules, { recursive: true });
	cpSync(moduleDir, workModule, {
		recursive: true,
		filter: (src) => !norm(src).split('/').includes('node_modules')
	});
	symlinkSync(join(CORE_ROOT, 'node_modules'), join(work, 'node_modules'), 'junction');

	try {
		const npm = /** @type {Record<string, string>} */ (pkg.npm ?? {});
		if (Object.keys(npm).length && opts.installPackages !== false) {
			log(`Pakete: ${Object.keys(npm).join(', ')}`);
			writeFileSync(
				join(workModules, 'package.json'),
				JSON.stringify({ private: true, dependencies: npm })
			);
			await run(
				process.execPath,
				['install', '--production', '--ignore-scripts', '--no-progress', '--no-summary'],
				{ cwd: workModules, log }
			);
		}

		// Für das Modul installierte Pakete gelten im ganzen Bundle (eine Kopie je Paket), außer geteilten der Host-ABI
		const hostRoots = new Set(
			[...HOST_PACKAGES.client, ...HOST_PACKAGES.server].map((p) =>
				p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0]
			)
		);
		const dedupe = installedPackageNames(join(workModules, 'node_modules')).filter(
			(n) => !hostRoots.has(n)
		);
		if (dedupe.length) log(`Eine Kopie je Paket: ${dedupe.length} Pakete aus dem Modul`);

		const hasUi = existsSync(join(workModule, 'ui.ts'));
		const cacheDir = join(work, '.vite');
		/** @type {Record<'client' | 'serverModule' | 'serverUi', Map<string, Set<string>>>} */
		const used = { client: new Map(), serverModule: new Map(), serverUi: new Map() };

		// Server getrennt: `module.ts` (beim Start geladen) braucht andere Host-Einträge als die SSR-Seiten aus `ui.ts`
		log('Server-Bundle');
		await buildOrExplain(
			viteConfig('server', {
				workModule,
				outDir,
				cacheDir,
				dedupe,
				used: used.serverModule,
				input: { module: join(workModule, 'module.ts') }
			})
		);
		if (hasUi)
			await buildOrExplain(
				viteConfig('server', {
					workModule,
					outDir,
					cacheDir,
					dedupe,
					used: used.serverUi,
					input: { ui: join(workModule, 'ui.ts') },
					keepOutDir: true
				})
			);

		log('Browser-Bundle');
		await buildOrExplain(
			viteConfig('client', {
				workModule,
				outDir,
				cacheDir,
				dedupe,
				used: used.client,
				input: { ui: '\0atrium-entry-client' },
				extra: [clientEntryPlugin({ id, workModule, hasUi })]
			})
		);

		log('CSS');
		const clientDir = join(outDir, 'client');
		const svelteCss = existsSync(join(clientDir, 'assets'))
			? readdirSync(join(clientDir, 'assets'))
					.filter((f) => f.endsWith('.css'))
					.map((f) => readFileSync(join(clientDir, 'assets', f), 'utf8'))
			: [];
		for (const f of existsSync(join(clientDir, 'assets'))
			? readdirSync(join(clientDir, 'assets'))
			: [])
			if (f.endsWith('.css')) rmSync(join(clientDir, 'assets', f));
		// nur die `<style>`-Blöcke der Svelte-Komponenten (eigene Klassen, ohne Ebenen); Utilities kommen aus dem
		// gemeinsamen CSS der App (`tailwind` unten)
		writeFileSync(join(clientDir, 'module.css'), svelteCss.join('\n'));
		const tailwind = await tailwindCandidates(workModule);
		removeUnreferencedAssets(clientDir);
		removeUnreferencedAssets(join(outDir, 'server'));

		const migrationsDir = join(moduleDir, 'migrations');
		const messages = /** @type {Record<string, unknown>} */ ({});
		if (existsSync(join(moduleDir, 'messages')))
			for (const f of readdirSync(join(moduleDir, 'messages')).sort()) {
				const m = MESSAGE_FILE.exec(f);
				if (m)
					messages[/** @type {string} */ (m[1])] = JSON.parse(
						readFileSync(join(moduleDir, 'messages', f), 'utf8')
					);
			}
		const keys = (/** @type {Map<string, Set<string>>} */ m) => [...m.keys()].sort();
		const meta = {
			metaVersion: META_VERSION,
			id,
			version: String(pkg.version ?? ''),
			contentHash,
			abi,
			builtAt: new Date().toISOString(),
			server: {
				module: 'server/module.js',
				moduleHost: keys(used.serverModule),
				ui: hasUi ? 'server/ui.js' : null,
				uiHost: keys(used.serverUi)
			},
			client: {
				entry: 'client/ui.js',
				css: ['client/module.css'],
				host: keys(used.client),
				tailwind
			},
			migrations: existsSync(migrationsDir)
				? readdirSync(migrationsDir)
						.filter((f) => f.endsWith('.sql'))
						.map((f) => f.slice(0, -4))
						.sort()
				: [],
			messages
		};
		writeFileSync(join(outDir, META_FILE), JSON.stringify(meta, null, '\t'));
		return meta;
	} finally {
		removeWorkDir(work);
	}
}

/** Vite-Build; Auflösungsfehler werden zu `CompileError` mit Paketname */
async function buildOrExplain(/** @type {import('vite').InlineConfig} */ config) {
	try {
		await build(config);
	} catch (e) {
		if (e instanceof CompileError) throw e;
		const cause = /** @type {any} */ (e)?.cause;
		if (cause instanceof CompileError) throw cause;
		const message = e instanceof Error ? e.message : String(e);
		const inner = /** @type {any} */ (e)?.errors?.find?.(
			(/** @type {unknown} */ x) => x instanceof CompileError
		);
		if (inner) throw inner;
		const name = unresolvedPackage(message);
		if (name)
			throw new CompileError(`Paket „${name}“ fehlt – im Modul unter npm angeben`, {
				kind: 'missingPackage',
				name
			});
		const forbidden =
			/„[^“]+“ ist (?:für Module nicht freigegeben|nicht Teil der Host-ABI|auf dem Server)[^\n]*/.exec(
				message
			);
		if (forbidden) throw new CompileError(forbidden[0], { kind: 'forbiddenImport' });
		throw new CompileError(message.split('\n').slice(0, 6).join('\n'), { kind: 'build' });
	}
}

export { CLIENT_PACKAGE_TARGETS };
