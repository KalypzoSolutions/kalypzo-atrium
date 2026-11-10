/**
 * SvelteKit-Adapter für Kalypzo Atrium: gleiche Ausgabe wie `@sveltejs/adapter-node` (dessen Startdateien
 * `files/` werden weiterverwendet), aber
 * - der Server wird mit **Rolldown** statt Rollup gebündelt (gemessen 2026-11-10 mit 14 Modulen: ~1 s statt ~24 s;
 *   CommonJS, JSON und Node-Auflösung kann Rolldown selbst),
 * - Brotli komprimiert mit einstellbarer Qualität statt immer der höchsten Stufe (Standard 9: fast gleich klein,
 *   ein Vielfaches schneller). Die Dateien werden mit begrenzter Parallelität komprimiert.
 *
 * Optionen wie adapter-node (`out`, `precompress`, `envPrefix`) plus `brotliQuality` (0–11).
 */
import {
	createReadStream,
	createWriteStream,
	existsSync,
	readdirSync,
	readFileSync,
	statSync
} from 'node:fs';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { rolldown } from 'rolldown';

const files = fileURLToPath(new URL('./files', import.meta.resolve('@sveltejs/adapter-node')));

/** Dateiendungen, die SvelteKit selbst vorkomprimiert (`kit/src/core/adapt/builder.js`) */
const COMPRESSIBLE = new Set([
	'.html',
	'.js',
	'.mjs',
	'.json',
	'.css',
	'.svg',
	'.xml',
	'.wasm',
	'.txt'
]);
const COMPRESS_PARALLEL = 8;

/**
 * Alle komprimierbaren Dateien unter `dir`; ein fehlender Ordner (z. B. ohne Prerendering) ergibt `[]`.
 * @param {string} dir
 */
function listFiles(dir) {
	if (!existsSync(dir)) return [];
	/** @type {string[]} */
	const out = [];
	/** @param {string} d */
	const walk = (d) => {
		for (const entry of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, entry.name);
			if (entry.isDirectory()) walk(p);
			else if (COMPRESSIBLE.has(extname(entry.name))) out.push(p);
		}
	};
	walk(dir);
	return out;
}

/**
 * @param {string} file
 * @param {'gz' | 'br'} format
 * @param {number} brotliQuality
 */
async function compressFile(file, format, brotliQuality) {
	const size = statSync(file).size;
	const stream =
		format === 'br'
			? zlib.createBrotliCompress({
					params: {
						[zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
						[zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality,
						[zlib.constants.BROTLI_PARAM_SIZE_HINT]: size
					}
				})
			: zlib.createGzip({ level: zlib.constants.Z_BEST_COMPRESSION });
	await pipeline(createReadStream(file), stream, createWriteStream(`${file}.${format}`));
}

/**
 * @param {string} dir
 * @param {number} brotliQuality
 */
async function compressDir(dir, brotliQuality) {
	/** @type {Array<() => Promise<void>>} */
	const jobs = listFiles(dir).flatMap((f) => [
		() => compressFile(f, 'gz', brotliQuality),
		() => compressFile(f, 'br', brotliQuality)
	]);
	let next = 0;
	const worker = async () => {
		while (next < jobs.length) await jobs[next++]();
	};
	await Promise.all(Array.from({ length: COMPRESS_PARALLEL }, worker));
}

/**
 * Ersetzt die Platzhalter der adapter-node-Startdateien (wie `@rollup/plugin-replace` mit
 * `preventAssignment`): nur in `entries`, nur ganze Bezeichner, keine Zuweisungen.
 * @param {string} entries
 * @param {Record<string, string>} values
 * @returns {import('rolldown').Plugin}
 */
function replacePlaceholders(entries, values) {
	const dir = entries.replace(/\\/g, '/');
	const pattern = new RegExp(`\\b(${Object.keys(values).join('|')})\\b(?!\\s*=[^=])`, 'g');
	return {
		name: 'atrium-adapter:replace',
		transform(code, id) {
			if (!id.replace(/\\/g, '/').startsWith(dir + '/')) return null;
			return { code: code.replace(pattern, (m) => values[m] ?? m), map: null };
		}
	};
}

const ROOT_MARKER = '__ATRIUM_BUILD_ROOT_REL__';
const ENV_DIR_LINE = 'const dir = path.dirname(fileURLToPath(import.meta.url));';

/**
 * `env.js` bestimmt den Build-Ordner aus seinem eigenen Speicherort (`import.meta.url`). Rollup lässt den Code im
 * Einstieg `env.js`; Rolldown legt Einstiege, die andere Einstiege importieren, als Fassade an und verschiebt den
 * Code nach `server/chunks/…`. Darum: Pfad relativ zum tatsächlichen Chunk auf den Build-Ordner zurückrechnen.
 * @param {string} entries
 * @returns {import('rolldown').Plugin}
 */
function buildRootFromChunk(entries) {
	const envFile = `${entries.replace(/\\/g, '/')}/env.js`;
	return {
		name: 'atrium-adapter:build-root',
		transform(code, id) {
			if (id.replace(/\\/g, '/') !== envFile) return null;
			if (!code.includes(ENV_DIR_LINE)) {
				throw new Error('adapter-atrium: env.js von adapter-node hat sich geändert (Build-Ordner)');
			}
			return {
				code: code.replace(
					ENV_DIR_LINE,
					`const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ${ROOT_MARKER});`
				),
				map: null
			};
		},
		renderChunk(code, chunk) {
			if (!code.includes(ROOT_MARKER)) return null;
			const depth = chunk.fileName.split('/').length - 1;
			const rel = depth ? Array.from({ length: depth }, () => '..').join('/') : '.';
			return { code: code.replaceAll(ROOT_MARKER, JSON.stringify(rel)), map: null };
		}
	};
}

/**
 * @param {{ out?: string; precompress?: boolean; envPrefix?: string; brotliQuality?: number }} [opts]
 * @returns {import('@sveltejs/kit').Adapter}
 */
export default function adapter(opts = {}) {
	const { out = 'build', precompress = true, envPrefix = '', brotliQuality = 9 } = opts;

	return {
		name: 'adapter-atrium',
		async adapt(builder) {
			const tmp = builder.getBuildDirectory('adapter-atrium');
			builder.rimraf(out);
			builder.rimraf(tmp);
			builder.mkdirp(tmp);

			builder.log.minor('Copying assets');
			builder.writeClient(`${out}/client${builder.config.kit.paths.base}`);
			builder.writePrerendered(`${out}/prerendered${builder.config.kit.paths.base}`);

			builder.log.minor('Building server');
			const entries = `${tmp}/entries`;
			builder.copy(files, entries);

			const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
			const server = builder.getServerDirectory().replace(/\\/g, '/');
			/** @type {Record<string, string>} */
			const input = {
				index: `${entries}/index.js`,
				env: `${entries}/env.js`,
				handler: `${entries}/handler.js`,
				shims: `${entries}/shims.js`
			};
			if (builder.hasServerInstrumentationFile?.()) {
				input['instrumentation.server'] = `${server}/instrumentation.server.js`;
			}

			const bundling = (async () => {
				const bundle = await rolldown({
					input,
					platform: 'node',
					external: Object.keys(pkg.dependencies || {}).map((d) => new RegExp(`^${d}(\\/.*)?$`)),
					resolve: { conditionNames: ['node', 'import', 'default'] },
					// Hinweise zu Zyklen in Fremdpaketen (kysely …) sind beim Bündeln der fertigen Ausgabe nur Rauschen
					onLog(level, log, handler) {
						if (log.code === 'CIRCULAR_DEPENDENCY' || log.code === 'EMPTY_BUNDLE') return;
						handler(level, log);
					},
					plugins: [
						{
							name: 'atrium-adapter:alias',
							resolveId(id) {
								if (id === 'SERVER') return `${server}/index.js`;
								if (id === 'MANIFEST') return `${server}/manifest.js`;
								return null;
							}
						},
						buildRootFromChunk(entries),
						replacePlaceholders(entries, {
							BASE: JSON.stringify(builder.config.kit.paths.base),
							ENV_PREFIX: JSON.stringify(envPrefix),
							PRECOMPRESS: JSON.stringify(precompress),
							PRERENDERED: `new Set(${JSON.stringify(builder.prerendered.paths)})`
						})
					]
				});
				const prefix = server.length + 1;
				await bundle.write({
					dir: out,
					format: 'esm',
					sourcemap: true,
					chunkFileNames: 'server/chunks/[name]-[hash].js',
					// Server-Dateien von Vite behalten ihren Pfad (sonst Zyklen, siehe sveltejs/kit#16092)
					manualChunks(id) {
						const p = id.replace(/\\/g, '/');
						return p.startsWith(server + '/') ? p.slice(prefix) : undefined;
					}
				});
				await bundle.close();
			})();

			// Komprimieren und Bündeln gleichzeitig (Komprimieren läuft im libuv-Threadpool)
			const compressing = precompress
				? (builder.log.minor('Compressing assets'),
					Promise.all([
						compressDir(`${out}/client`, brotliQuality),
						compressDir(`${out}/prerendered`, brotliQuality)
					]))
				: Promise.resolve();
			await Promise.all([bundling, compressing]);

			if (builder.hasServerInstrumentationFile?.()) {
				builder.instrument?.({
					entrypoint: `${out}/index.js`,
					instrumentation: `${out}/instrumentation.server.js`,
					module: { exports: ['path', 'host', 'port', 'server'] }
				});
			}
		},
		supports: {
			read: () => true,
			instrumentation: () => true
		}
	};
}
