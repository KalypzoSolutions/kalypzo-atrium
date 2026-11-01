/**
 * Paketformat der Module (Kalypzo Atrium, Phase 2): `atrium-module.json` je Modul, Katalog `atrium-modules.json`,
 * Konventionen (Ordner = ID, Migrationen = Dateien), Quellangaben und Versionsbereiche.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { entries } from 'virtual:atrium-modules/server';
import { conventionProblem } from '$lib/server/core/modules/load';
import {
	MODULE_CATALOG_FILE,
	formatModuleSource,
	moduleCatalogSchema,
	parseModulePackage,
	parseModuleSource,
	versionSatisfies
} from '$lib/server/core/modules/package/schema';
import { manifestFromPackage } from '$lib/sdk/server';
import { moduleIds, modulesDir } from '../../tools/modules-dir.js';
import type { ModuleDefinition } from '$lib/server/core/modules/types';

const DIR = modulesDir();

describe('installierte Module erfüllen das Paketformat', () => {
	it('jeder Modulordner ist im Build', () => {
		expect(entries.map((e) => e.folder)).toEqual(moduleIds(DIR));
	});

	it.each(entries.map((e) => [e.folder, e] as const))('%s', (_id, e) => {
		expect(conventionProblem(e.folder, e.definition, e.migrationFiles)).toBeNull();
		const pkg = parseModulePackage(e.definition.package);
		const m = e.definition.manifest;
		expect(manifestFromPackage(pkg)).toEqual({
			id: m.id,
			name: m.name,
			...(m.description ? { description: m.description } : {}),
			version: m.version,
			dependencies: m.dependencies,
			optionalDependencies: m.optionalDependencies ?? []
		});
		expect([...pkg.permissions].sort()).toEqual([...m.permissions].sort());
		// Harte Abhängigkeiten passen zu den mitgelieferten Versionen
		for (const [dep, { version }] of Object.entries(pkg.dependencies)) {
			const target = entries.find((x) => x.folder === dep)?.definition.manifest.version;
			expect(target && versionSatisfies(target, version), `${m.id} → ${dep}`).toBe(true);
		}
	});

	it('Katalog listet genau die Modulordner', () => {
		const file = join(DIR, MODULE_CATALOG_FILE);
		if (!existsSync(file)) return; // Fixture-Verzeichnisse ohne Katalog
		const catalog = moduleCatalogSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
		expect(catalog.modules.map((m) => m.id).sort()).toEqual(moduleIds(DIR));
		for (const m of catalog.modules) expect(existsSync(join(DIR, m.path, 'module.ts'))).toBe(true);
	});
});

describe('Konventionen', () => {
	const def = (over: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
		manifest: {
			id: 'demo',
			name: 'Demo',
			version: '1.0.0',
			dependencies: [],
			permissions: [],
			navigation: []
		},
		package: {},
		migrations: [{ name: '0001_init', sql: '' }],
		...over
	});
	it('erkennt Ordner ≠ ID, fehlendes Paket und abweichende Migrationen', () => {
		expect(conventionProblem('demo', def(), ['0001_init'])).toBeNull();
		expect(conventionProblem('other', def(), ['0001_init'])).toMatch(/Ordner/);
		expect(conventionProblem('demo', def({ package: undefined }), ['0001_init'])).toMatch(
			/atrium-module\.json fehlt/
		);
		expect(conventionProblem('demo', def(), ['0001_init', '0002_more'])).toMatch(/Migrationen/);
		expect(conventionProblem('demo', undefined, [])).toMatch(/keine Moduldefinition/);
	});
});

describe('Paketschema', () => {
	const base = {
		schema: 1,
		id: 'demo',
		name: 'Demo',
		version: '1.2.3',
		core: '>=2.0.0-0 <3.0.0'
	};
	it('setzt Standards und prüft Felder', () => {
		const p = parseModulePackage(base);
		expect(p.dependencies).toEqual({});
		expect(p.npm).toEqual({});
		expect(() => parseModulePackage({ ...base, version: '1.2' })).toThrow(/SemVer/);
		expect(() => parseModulePackage({ ...base, core: 'kaputt' })).toThrow(/Versionsbereich/);
		expect(() => parseModulePackage({ ...base, permissions: ['other.x.view'] })).toThrow(
			/gehört nicht/
		);
		expect(() =>
			parseModulePackage({ ...base, dependencies: { demo: { version: '^1.0.0' } } })
		).toThrow(/sich selbst/);
		expect(() =>
			parseModulePackage({
				...base,
				dependencies: { a1: { version: '^1.0.0' } },
				optionalDependencies: { a1: { version: '^1.0.0' } }
			})
		).toThrow(/Zugleich/);
		expect(() => parseModulePackage({ ...base, npm: { yjs: '^13.0.0' } })).toThrow(/Exakte/);
		expect(() => parseModulePackage({ ...base, unbekannt: 1 })).toThrow();
		expect(() =>
			parseModulePackage({
				...base,
				dependencies: { a1: { version: '^1.0.0', source: 'https://evil.example/x' } }
			})
		).toThrow(/Quelle/);
	});
	it('Versionsbereiche zählen Vorabversionen mit', () => {
		expect(versionSatisfies('2.0.0-pre.1', '>=2.0.0-0 <3.0.0')).toBe(true);
		expect(versionSatisfies('3.0.0', '>=2.0.0-0 <3.0.0')).toBe(false);
		expect(versionSatisfies('1.14.2', '^1.14.0')).toBe(true);
		expect(versionSatisfies('1.13.0', '^1.14.0')).toBe(false);
	});
});

describe('Quellangaben', () => {
	it('liest Kurzform und GitHub-URLs', () => {
		expect(parseModuleSource('github:org/ep-intern-modules/modules/members#v2.0.0')).toEqual({
			type: 'github',
			owner: 'org',
			repo: 'ep-intern-modules',
			path: 'modules/members',
			ref: 'v2.0.0'
		});
		expect(parseModuleSource('github:org/repo')).toEqual({
			type: 'github',
			owner: 'org',
			repo: 'repo',
			path: '',
			ref: null
		});
		expect(parseModuleSource('https://github.com/org/repo/tree/main/modules/tasks')).toEqual({
			type: 'github',
			owner: 'org',
			repo: 'repo',
			path: 'modules/tasks',
			ref: 'main'
		});
		expect(parseModuleSource('https://github.com/org/repo.git')?.repo).toBe('repo');
	});
	it('lehnt fremde Hosts, Pfad-Ausbrüche und Unsinn ab', () => {
		for (const bad of [
			'http://github.com/org/repo',
			'https://gitlab.com/org/repo',
			'https://github.com/org',
			'https://github.com/org/repo/blob/main/x',
			'github:org/repo/../x',
			'github:org/repo/a/./b',
			'github:org/repo#a..b',
			'github:org',
			'ftp://x',
			''
		]) {
			expect(parseModuleSource(bad), bad).toBeNull();
		}
	});
	it('Kurzform ist umkehrbar', () => {
		const s = 'github:org/repo/modules/x#main';
		expect(formatModuleSource(parseModuleSource(s)!)).toBe(s);
	});
});
