/**
 * Svelte-Komponente für SSR-Tests laden (Ersatz für das Svelte-Vite-Plugin unter `bun test`).
 *
 * Bündelt die Komponente samt aller importierten `.svelte`/`.svelte.ts`-Dateien (auch aus node_modules, z. B. bits-ui)
 * mit `Bun.build` und dem Svelte-Compiler (`generate: 'server'`) nach `.svelte-kit/bun-svelte/` und importiert das
 * Ergebnis. `svelte` bleibt extern: Test und Komponente nutzen dieselbe Laufzeit (`svelte/server`).
 * Aliase (`$lib` …) löst der Bundler über `.svelte-kit/tsconfig.json` auf.
 *
 * Warum nicht per Laufzeit-Plugin? Bun ruft `onLoad` zur Laufzeit unter Windows nicht auf allen Laufwerken auf;
 * Bundler-Plugins sind davon nicht betroffen.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Component } from 'svelte';
import { compile, compileModule } from 'svelte/compiler';

const ROOT = resolve(import.meta.dir, '..', '..');
const OUT = join(ROOT, '.svelte-kit', 'bun-svelte');

const sveltePlugin: Bun.BunPlugin = {
	name: 'svelte-ssr',
	setup(build) {
		const ts = new Bun.Transpiler({ loader: 'ts' });
		// Vite-Asset-Importe (`…?url`): im SSR-Test reicht ein Platzhalter
		build.onResolve({ filter: /\?url$/ }, (args) => ({ path: args.path, namespace: 'asset-url' }));
		build.onLoad({ filter: /.*/, namespace: 'asset-url' }, (args) => ({
			contents: `export default ${JSON.stringify(args.path)};`,
			loader: 'js'
		}));
		build.onLoad({ filter: /\.svelte$/ }, (args) => {
			const { js } = compile(readFileSync(args.path, 'utf8'), {
				filename: relative(ROOT, args.path),
				generate: 'server'
			});
			return { contents: js.code, loader: 'js' };
		});
		build.onLoad({ filter: /\.svelte\.(ts|js)$/ }, (args) => {
			let source = readFileSync(args.path, 'utf8');
			if (args.path.endsWith('.ts')) source = ts.transformSync(source);
			const { js } = compileModule(source, {
				filename: relative(ROOT, args.path),
				generate: 'server'
			});
			return { contents: js.code, loader: 'js' };
		});
	}
};

const cache = new Map<string, Promise<Component<never>>>();

/** Lädt `file` (absolut oder relativ zur Projektwurzel) als SSR-Komponente. */
export function loadSvelteComponent<P extends Record<string, unknown>>(
	file: string
): Promise<Component<P>> {
	const entry = resolve(ROOT, file);
	let p = cache.get(entry);
	if (!p) {
		p = (async () => {
			mkdirSync(OUT, { recursive: true });
			const res = await Bun.build({
				entrypoints: [entry],
				outdir: OUT,
				naming: `${basename(entry, '.svelte')}-${process.pid}-[hash].js`,
				target: 'bun',
				format: 'esm',
				// Svelte-Bibliotheken (bits-ui, runed) exportieren über die Bedingung `svelte`
				conditions: ['svelte'],
				// svelte: gemeinsame Laufzeit; virtuelle Module und `$app/*` liefert der Preload zur Laufzeit
				external: ['svelte', 'svelte/*', 'virtual:*', '$app/*'],
				plugins: [sveltePlugin]
			});
			if (!res.success) throw new AggregateError(res.logs, `Svelte-Build fehlgeschlagen: ${file}`);
			const out = res.outputs.find((o) => o.kind === 'entry-point')!;
			return (await import(pathToFileURL(out.path).href)).default as Component<never>;
		})();
		cache.set(entry, p);
	}
	return p as Promise<Component<P>>;
}
