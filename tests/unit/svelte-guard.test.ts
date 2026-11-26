/**
 * Ersatz für die wichtigsten Regeln von eslint-plugin-svelte (seit der Umstellung auf Biome): kein `{@html}`
 * (XSS, Nutzereingaben nie als HTML – formatierter Text über `RichTextView`), kein `{@debug}`/`$inspect`
 * (Debug-Reste) und `{#each}` immer mit Schlüssel. Kompilierfehler und a11y-Warnungen prüft `svelte-check`.
 * Geprüft werden `src/**` und die installierten Module (`ATRIUM_MODULES_DIR`).
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'svelte/compiler';
import { modulesDir } from '../../tools/modules-dir.js';

const ROOT = process.cwd();

function svelteFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory()
			? e.name === 'node_modules'
				? []
				: svelteFiles(join(dir, e.name))
			: e.name.endsWith('.svelte')
				? [join(dir, e.name)]
				: []
	);
}

interface Node {
	type?: string;
	start?: number;
	key?: unknown;
	[k: string]: unknown;
}

/** Verstöße einer Datei als `Zeile: Text` */
export function svelteGuard(code: string, file = 'x.svelte'): string[] {
	const found: string[] = [];
	const lineOf = (pos: number) => code.slice(0, pos).split('\n').length;
	const ast = parse(code, { filename: file, modern: true }) as unknown as Node;
	const seen = new Set<unknown>();
	const walk = (n: unknown) => {
		if (!n || typeof n !== 'object' || seen.has(n)) return;
		seen.add(n);
		const node = n as Node;
		const at = typeof node.start === 'number' ? lineOf(node.start) : 0;
		if (node.type === 'HtmlTag')
			found.push(`${at}: {@html} – Nutzereingaben nie als HTML ausgeben`);
		if (node.type === 'DebugTag') found.push(`${at}: {@debug} entfernen`);
		if (node.type === 'EachBlock' && !node.key) found.push(`${at}: {#each} ohne Schlüssel`);
		for (const v of Object.values(node)) {
			if (Array.isArray(v)) v.forEach(walk);
			else if (v && typeof v === 'object') walk(v);
		}
	};
	walk(ast);
	for (const m of code.matchAll(/\$inspect\s*\(/g))
		found.push(`${lineOf(m.index ?? 0)}: $inspect entfernen`);
	return found;
}

describe('Svelte-Wächter', () => {
	it('erkennt die Muster', () => {
		const code = [
			'<script>let xs = $state([]); $inspect(xs);</script>',
			'{@html "<b>x</b>"}',
			'{#each xs as x}{x}{/each}',
			'{#each xs as x (x)}{x}{/each}',
			'{@debug xs}'
		].join('\n');
		expect(svelteGuard(code).map((v) => v.split(':')[0])).toEqual(['2', '3', '5', '1']);
	});

	it('keine Verstöße in src/** und den installierten Modulen', () => {
		const files = [...svelteFiles(join(ROOT, 'src')), ...svelteFiles(modulesDir())];
		expect(files.length).toBeGreaterThan(0);
		const found = files.flatMap((f) =>
			svelteGuard(readFileSync(f, 'utf8'), f).map((v) => `${relative(ROOT, f)}:${v}`)
		);
		expect(found).toEqual([]);
	});
});
