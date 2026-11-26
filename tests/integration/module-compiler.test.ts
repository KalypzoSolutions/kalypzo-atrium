/**
 * Modul-Compiler (Umbau „Module ohne App-Neubau“, Phase 2): Fixture-Module einzeln kompilieren – wie in Produktion als
 * eigener Prozess – und prüfen, dass die Bundles die Host-ABI nutzen statt Kopien, das CSS die Modulklassen enthält
 * und das Server-Bundle gegen die echte Host-Registry lädt. Dazu die Fehlerfälle mit klarer Meldung.
 */
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { host } from 'virtual:atrium-host/server';
import type { ModuleDefinition } from '$lib/server/core/modules/types';
import { hostAbiHash } from '../../tools/host-abi.js';
import { CORE_ROOT } from '../../tools/modules-dir.js';
import { contentHashOfDir } from '../../scripts/supervisor/lib.mjs';
import {
	COMPILE_PREFIX,
	removeWorkDir,
	type ModuleBundleMeta
} from '../../scripts/module-compiler/lib.mjs';

const FIXTURES = join(CORE_ROOT, 'tests', 'fixtures', 'modules');
const COMPILER = join(CORE_ROOT, 'scripts', 'module-compiler', 'compile.mjs');
const root = mkdtempSync(join(tmpdir(), 'atrium-compile-'));

interface CompileResult {
	ok: boolean;
	meta?: ModuleBundleMeta;
	error?: { kind: string; message: string; package: string | null };
}

/** Compiler als eigener Prozess (wie der Supervisor ihn startet) */
async function compile(moduleDir: string, outDir: string): Promise<CompileResult> {
	const p = Bun.spawn([process.execPath, COMPILER, moduleDir, outDir, '--no-install'], {
		cwd: CORE_ROOT,
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, NODE_ENV: 'production' }
	});
	const [out, err] = await Promise.all([
		new Response(p.stdout).text(),
		new Response(p.stderr).text()
	]);
	await p.exited;
	const line = out.split(/\r?\n/).find((l) => l.startsWith(COMPILE_PREFIX));
	if (!line) throw new Error(`Kein Ergebnis vom Compiler:\n${out}\n${err}`);
	return JSON.parse(line.slice(COMPILE_PREFIX.length)) as CompileResult;
}

const files = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
	);

const results: Record<string, CompileResult> = {};

beforeAll(async () => {
	await Promise.all(
		['fx-board', 'fx-people', 'fx-consumer'].map(async (id) => {
			results[id] = await compile(join(FIXTURES, id), join(root, id));
		})
	);
}, 180_000);

afterAll(() => removeWorkDir(root));

describe('Fixture-Module kompilieren', () => {
	it('alle drei erfolgreich, Kennungen und Migrationen stimmen', () => {
		for (const id of ['fx-board', 'fx-people', 'fx-consumer']) {
			const r = results[id]!;
			expect(r.error, id).toBeUndefined();
			expect(r.ok, id).toBe(true);
			const meta = r.meta!;
			expect(meta.id).toBe(id);
			expect(meta.abi).toBe(hostAbiHash());
			expect(meta.contentHash).toBe(contentHashOfDir(join(FIXTURES, id)));
			const migDir = join(FIXTURES, id, 'migrations');
			const expected = existsSync(migDir)
				? readdirSync(migDir)
						.filter((f) => f.endsWith('.sql'))
						.map((f) => f.slice(0, -4))
						.sort()
				: [];
			expect(meta.migrations).toEqual(expected);
			expect(existsSync(join(root, id, 'meta.json'))).toBe(true);
			expect(existsSync(join(root, id, '.work'))).toBe(false);
		}
	});

	it('Bundles importieren die Host-ABI über die Registry, nie direkt', () => {
		const js = files(join(root, 'fx-board')).filter((f) => f.endsWith('.js'));
		expect(js.length).toBeGreaterThan(3);
		for (const f of js) {
			const code = readFileSync(f, 'utf8');
			expect(code, f).not.toContain('atrium-host:');
			expect(code, f).not.toMatch(
				/from\s*["'](svelte|svelte\/[^"']+|\$app\/[^"']+|svelte-sonner)["']/
			);
			expect(code, f).not.toMatch(/from\s*["'][^"']*src\/lib\//);
		}
		// Seiten-Chunks greifen auf die Svelte-Laufzeit des Core zu
		const client = js
			.filter((f) => f.includes(`${join('fx-board', 'client')}`))
			.map((f) => readFileSync(f, 'utf8'))
			.join('\n');
		expect(client).toMatch(/__atriumHost\.get\(["'`]svelte\/internal\/client["'`]/);
	});

	it('Browser teilt nur die Laufzeit und Dateien mit Zustand, Server alles Freigegebene', () => {
		const meta = results['fx-board']!.meta!;
		expect(meta.client.host).toContain('svelte/internal/client');
		expect(meta.client.host).toContain('lib:i18n/index.ts');
		// UI-Bausteine bringt das Bundle im Browser selbst mit …
		expect(meta.client.host.some((k: string) => k.startsWith('lib:components/ui/card'))).toBe(
			false
		);
		// … auf dem Server kommen sie vom Core
		expect(meta.server.uiHost).toContain('lib:components/ui/card/index.ts');
		expect(meta.server.uiHost).toContain('svelte/internal/server');
		expect(meta.server.moduleHost).toContain('lib:sdk/server/index.ts');
		expect(meta.server.moduleHost).toContain('drizzle-orm');
		// module.ts braucht keine Seiten-Komponenten
		expect(meta.server.moduleHost.some((k: string) => k.startsWith('lib:components/'))).toBe(false);
	});

	it('CSS enthält die eigenen Tailwind-Klassen des Moduls', () => {
		const css = readFileSync(join(root, 'fx-board', 'client', 'module.css'), 'utf8');
		expect(css).toContain('min-h-\\[17\\.25rem\\]');
		expect(css).toContain('@layer utilities');
	});

	it('ungenutzte Teile des Core werden nicht mitgebündelt (Tree-Shaking der Sammel-Exporte)', () => {
		const all = files(join(root, 'fx-board', 'client'));
		const size = all.reduce((s, f) => s + readFileSync(f).byteLength, 0);
		expect(
			all.some((f) => f.endsWith('.wasm')),
			'Barcode-WebAssembly'
		).toBe(false);
		const js = all
			.filter((f) => f.endsWith('.js'))
			.map((f) => readFileSync(f, 'utf8'))
			.join('\n');
		expect(js).not.toContain('prosemirror');
		expect(size).toBeLessThan(250_000);
	});

	it('Server-Bundle lädt gegen die echte Host-Registry und entspricht dem Quellmodul', async () => {
		const meta = results['fx-board']!.meta!;
		await host.preload(meta.server.moduleHost);
		const built = (await import(pathToFileURL(join(root, 'fx-board', meta.server.module)).href))
			.default as ModuleDefinition;
		const source = (await import(join(FIXTURES, 'fx-board', 'module.ts')))
			.default as ModuleDefinition;
		expect(built.manifest.id).toBe('fx-board');
		expect(built.manifest.version).toBe(source.manifest.version);
		expect(built.manifest.permissions).toEqual(source.manifest.permissions);
		expect(built.migrations?.map((m) => m.name)).toEqual(meta.migrations);
		expect(built.migrations?.map((m) => m.sql)).toEqual(source.migrations?.map((m) => m.sql));
		expect(built.endpoints?.map((e) => `${e.method} ${e.path}`)).toEqual(
			source.endpoints?.map((e) => `${e.method} ${e.path}`)
		);
		expect(typeof built.jobs?.[0]?.run).toBe('function');
	});
});

describe('Fehler beim Kompilieren', () => {
	/** Mini-Modul in einen Ordner schreiben */
	const makeModule = (id: string, folder: string, moduleTs: string) => {
		const dir = join(root, 'src', folder);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, 'atrium-module.json'),
			JSON.stringify({ schema: 1, id, name: id, version: '1.0.0', core: '>=2.0.0-0 <3.0.0' })
		);
		writeFileSync(join(dir, 'module.ts'), moduleTs);
		return dir;
	};
	const base = (extra: string) =>
		`import { defineModule, manifestFromPackage } from '$lib/sdk/server';\n${extra}\nimport pkg from './atrium-module.json';\nexport default defineModule({ package: pkg, manifest: { ...manifestFromPackage(pkg), permissions: [], navigation: [] }, migrations: [] });\n`;

	it('fehlendes Paket → missingPackage mit Paketname', async () => {
		const dir = makeModule(
			'fc-missing',
			'fc-missing',
			base(`import { gibts } from '@atrium-test/gibt-es-nicht/sub';\nconsole.log(gibts);`)
		);
		const r = await compile(dir, join(root, 'out-missing'));
		expect(r.ok).toBe(false);
		expect(r.error?.kind).toBe('missingPackage');
		expect(r.error?.package).toBe('@atrium-test/gibt-es-nicht');
	}, 60_000);

	it('Core-Interna ($lib/server) → forbiddenImport', async () => {
		const dir = makeModule(
			'fc-forbidden',
			'fc-forbidden',
			base(`import { getDb } from '$lib/server/core/database/client';\nconsole.log(getDb);`)
		);
		const r = await compile(dir, join(root, 'out-forbidden'));
		expect(r.ok).toBe(false);
		expect(r.error?.kind).toBe('forbiddenImport');
		expect(r.error?.message).toContain('$lib/server/core/database/client');
	}, 60_000);

	it('Ordner ≠ Modul-ID → invalidModule', async () => {
		const dir = makeModule('fc-other', 'fc-folder', base(''));
		const r = await compile(dir, join(root, 'out-folder'));
		expect(r.ok).toBe(false);
		expect(r.error?.kind).toBe('invalidModule');
	}, 60_000);
});
