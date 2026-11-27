/**
 * Vorkompilierte Modul-Bundles laden (Umbau „Module ohne App-Neubau“, Phase 3): `fx-bundle` liegt nicht im
 * Modulverzeichnis und wird nie in den App-Build kompiliert – der Test übersetzt es mit dem Modul-Compiler, legt es
 * in eine Bundle-Ablage und lädt es zur Laufzeit. Danach verhält es sich wie ein eingebautes Modul (Migration,
 * Endpunkte, Texte). Fehlerfälle machen nur das betroffene Modul „defekt“.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
	adminContext,
	apiCall,
	createApiKey,
	enableModule,
	registerCoreApi,
	syncModules,
	useTestDatabase
} from '$testing';
import {
	bundleClientFile,
	bundleUtilities,
	clientBundles,
	loadBundleModules,
	loadedBundle,
	readActiveBundles,
	resetLoadedBundlesForTests
} from '$lib/server/core/modules/bundles';
import {
	brokenModules,
	getDefinition,
	resetBrokenModulesForTests,
	unregisterModule
} from '$lib/server/core/modules/registry';
import { moduleUiLoader } from '$lib/sdk/client/module-ui-registry';
import type { RequestContext } from '$lib/sdk/types';
import { CORE_ROOT } from '../../tools/modules-dir.js';
import { COMPILE_PREFIX, removeWorkDir } from '../../scripts/module-compiler/lib.mjs';

const FIXTURE = join(CORE_ROOT, 'tests', 'fixtures', 'bundle-modules', 'fx-bundle');
const COMPILER = join(CORE_ROOT, 'scripts', 'module-compiler', 'compile.mjs');
const root = mkdtempSync(join(tmpdir(), 'atrium-bundles-'));
const bundles = join(root, 'bundles');
const ADMIN = 'bundle-admin@example.test';
const PW = 'correct-horse-battery';

let close: () => Promise<void>;
let admin: RequestContext;
let key = '';

async function compile(moduleDir: string, outDir: string) {
	const p = Bun.spawn([process.execPath, COMPILER, moduleDir, outDir, '--no-install'], {
		cwd: CORE_ROOT,
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const out = await new Response(p.stdout).text();
	await p.exited;
	const line = out.split(/\r?\n/).find((l) => l.startsWith(COMPILE_PREFIX));
	const r = JSON.parse(line!.slice(COMPILE_PREFIX.length)) as { ok: boolean; error?: unknown };
	if (!r.ok) throw new Error(`Kompilieren fehlgeschlagen: ${JSON.stringify(r.error)}`);
}

const writeActive = (modules: Record<string, { dir: string }>) => {
	mkdirSync(bundles, { recursive: true });
	writeFileSync(join(bundles, 'active.json'), JSON.stringify({ version: 1, modules }));
};

beforeAll(async () => {
	await compile(FIXTURE, join(bundles, 'fx-bundle', 'b1'));
	writeActive({ 'fx-bundle': { dir: 'fx-bundle/b1' } });
	close = (await useTestDatabase()).close;
	registerCoreApi();
	resetBrokenModulesForTests();
	expect(await loadBundleModules(bundles)).toEqual(['fx-bundle']);
	await syncModules();
	admin = await adminContext(ADMIN, PW);
	await enableModule(admin, 'fx-bundle');
	admin = await adminContext(ADMIN, PW);
	key = (
		await createApiKey(admin, {
			name: 'Bundle',
			scopes: ['fx-bundle.item.view', 'core.api.manage']
		})
	).key;
}, 120_000);

afterAll(async () => {
	unregisterModule('fx-bundle');
	resetLoadedBundlesForTests();
	resetBrokenModulesForTests();
	await close();
	removeWorkDir(root);
});

describe('Bundle-Modul zur Laufzeit', () => {
	it('ist registriert, Migration lief, Endpunkte und Modultexte funktionieren', async () => {
		expect(getDefinition('fx-bundle')?.manifest.version).toBe('1.0.0');
		const empty = await apiCall<{ greeting: string; items: string[] }>(
			key,
			'GET',
			'/modules/fx-bundle/items'
		);
		expect(empty.status, JSON.stringify(empty.body)).toBe(200);
		expect(empty.body.data?.greeting).toBe('Hallo aus dem Bundle');
		expect(empty.body.data?.items).toEqual([]);
		const created = await apiCall(key, 'POST', '/modules/fx-bundle/items', { name: 'Erster' });
		expect(created.status, JSON.stringify(created.body)).toBe(201);
		const bad = await apiCall(key, 'POST', '/modules/fx-bundle/items', { name: '' });
		expect(bad.status).toBe(422);
		const after = await apiCall<{ items: string[] }>(key, 'GET', '/modules/fx-bundle/items');
		expect(after.body.data?.items).toEqual(['Erster']);
	});

	it('Browser-Angaben und Auslieferung nur aus client/ des geladenen Builds', () => {
		const [b] = clientBundles();
		expect(b).toEqual({
			id: 'fx-bundle',
			base: '/_atrium/modules/fx-bundle/b1/',
			entry: 'client/ui.js',
			css: ['client/module.css'],
			host: expect.arrayContaining(['svelte/internal/client', 'lib:i18n/index.ts'])
		});
		// Pfade relativ zum Bundle-Ordner wie in meta.json (= URL hinter `base`), aber nur unter client/
		expect(bundleClientFile('fx-bundle', 'b1', 'client/ui.js')).toMatch(/client[\\/]ui\.js$/);
		expect(bundleClientFile('fx-bundle', 'b1', 'client/module.css')).toMatch(/module\.css$/);
		expect(bundleClientFile('fx-bundle', 'b1', 'ui.js')).toBeNull();
		expect(bundleClientFile('fx-bundle', 'b1', 'meta.json')).toBeNull();
		expect(bundleClientFile('fx-bundle', 'b1', 'server/module.js')).toBeNull();
		expect(bundleClientFile('fx-bundle', 'b1', 'client/../meta.json')).toBeNull();
		expect(bundleClientFile('fx-bundle', 'b1', 'client/../../../active.json')).toBeNull();
		expect(bundleClientFile('fx-bundle', 'other', 'client/ui.js')).toBeNull();
		expect(bundleClientFile('fx-board', 'b1', 'client/ui.js')).toBeNull();
	});

	it('gemeinsames Utilities-CSS: Klassen von Core und Modul in einer Tailwind-Reihenfolge', async () => {
		const u = await bundleUtilities();
		expect(u).not.toBeNull();
		expect(u!.url).toBe(`/_atrium/modules/_utilities/${u!.hash}/utilities.css`);
		const css = u!.css;
		// nur im Modul
		expect(css).toContain('min-h-\\[13\\.37rem\\]');
		// aus dem Core (Inhaltsbereich `<main>`)
		expect(css).toContain('.lg\\:p-8');
		// Mischfall: Basis-Klasse (auch im Core) VOR der Variante aus dem Modul – nur so gewinnt die Variante ab `sm`
		const base = css.indexOf('.p-4 {');
		const variant = css.indexOf('.sm\\:p-\\[1\\.37rem\\]');
		expect(base).toBeGreaterThan(-1);
		expect(variant).toBeGreaterThan(base);
		// gleiche Eingabe → gleiches Ergebnis (zwischengespeichert)
		expect((await bundleUtilities())!.hash).toBe(u!.hash);
	});

	it('SSR: moduleUiLoader liefert die Oberfläche aus dem Server-Bundle', async () => {
		const loader = moduleUiLoader('fx-bundle');
		expect(loader).toBeDefined();
		// Die Seiten selbst sind Svelte-SSR-Komponenten (im Bun-Test nicht ladbar) – hier zählen Routen-Tabelle
		// und dass der Lader die Host-Einträge auflöst
		const ui = await loader!().then(
			(m) => m,
			(e: unknown) => (e instanceof Error ? e : new Error(String(e)))
		);
		if (ui instanceof Error) expect(ui.message).not.toMatch(/Host-ABI|nicht vorgeladen/);
		else expect(Object.keys(ui.default.routes)).toEqual(['']);
		expect(loadedBundle('fx-bundle')?.meta.server.ui).toBe('server/ui.js');
	});
});

describe('Fehlerfälle beim Laden', () => {
	const fresh = join(root, 'broken');

	it('falsche ABI, fehlende meta.json und ungültige Einträge → nur diese Module defekt', async () => {
		// Kopie des fertigen Bundles mit anderer ABI-Kennung unter anderer ID
		const target = join(fresh, 'fx-old', 'b1');
		mkdirSync(target, { recursive: true });
		cpSync(join(bundles, 'fx-bundle', 'b1'), target, { recursive: true });
		const meta = JSON.parse(readFileSync(join(target, 'meta.json'), 'utf8'));
		writeFileSync(
			join(target, 'meta.json'),
			JSON.stringify({ ...meta, id: 'fx-old', abi: 'abi-0000000000000000' })
		);
		mkdirSync(join(fresh, 'fx-gone', 'b1'), { recursive: true });
		mkdirSync(fresh, { recursive: true });
		writeFileSync(
			join(fresh, 'active.json'),
			JSON.stringify({
				version: 1,
				modules: {
					'fx-old': { dir: 'fx-old/b1' },
					'fx-gone': { dir: 'fx-gone/b1' },
					'fx-evil': { dir: '../../etc' },
					'Fx-Upper': { dir: 'Fx-Upper/b1' }
				}
			})
		);
		expect(Object.keys(readActiveBundles(fresh).modules).sort()).toEqual(['fx-gone', 'fx-old']);
		resetBrokenModulesForTests();
		expect(await loadBundleModules(fresh)).toEqual([]);
		const broken = Object.fromEntries(brokenModules().map((b) => [b.id, b.reason]));
		expect(broken['fx-old']).toMatch(/andere Core-Version/);
		expect(broken['fx-gone']).toMatch(/fehlt oder ist beschädigt/);
		expect(getDefinition('fx-old')).toBeUndefined();
		// das funktionierende Bundle bleibt unberührt
		expect(getDefinition('fx-bundle')).toBeDefined();
	});

	it('ohne Datenverzeichnis bzw. active.json: keine Bundles, kein Fehler', async () => {
		expect(await loadBundleModules(null)).toEqual([]);
		expect(readActiveBundles(join(root, 'leer')).modules).toEqual({});
	});
});
