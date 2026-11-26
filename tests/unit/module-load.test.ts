/**
 * Module werden einzeln geladen: Scheitert der Import eines `module.ts` (etwa weil nach einem Core-Update ein
 * npm-Paket fehlt), wird nur dieses Modul „defekt“ – die übrigen laden, der Start bricht nicht ab.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import {
	loadBuiltInModules,
	missingPackageName,
	type ModuleEntry
} from '$lib/server/core/modules/load';
import {
	brokenModules,
	excludeUnresolvableModules,
	getDefinition,
	resetBrokenModulesForTests,
	unregisterModule
} from '$lib/server/core/modules/registry';
import type { ModuleDefinition } from '$lib/server/core/modules/types';

const IDS = ['ml-good', 'ml-missing', 'ml-user', 'ml-throws'];

const definition = (id: string, dependencies: string[] = []): ModuleDefinition => ({
	manifest: {
		id,
		name: `Modul ${id}`,
		version: '1.0.0',
		dependencies,
		permissions: [],
		navigation: []
	},
	package: {
		schema: 1,
		id,
		name: `Modul ${id}`,
		version: '1.0.0',
		core: '>=2.0.0-0 <3.0.0',
		dependencies: Object.fromEntries(dependencies.map((d) => [d, { version: '^1.0.0' }]))
	},
	migrations: []
});

const entry = (folder: string, load: ModuleEntry['load']): ModuleEntry => ({
	folder,
	load,
	migrationFiles: []
});

afterEach(() => {
	for (const id of IDS) unregisterModule(id);
	resetBrokenModulesForTests();
});

describe('missingPackageName', () => {
	it('liest den Paketnamen aus Bun- und Node-Meldungen', () => {
		expect(
			missingPackageName(new Error("Cannot find package '@tiptap/markdown' from '/x/a.js'"))
		).toBe('@tiptap/markdown');
		expect(
			missingPackageName(new Error("Cannot find package 'yjs' imported from /app/build/x.js"))
		).toBe('yjs');
		expect(missingPackageName(new Error("Cannot find module '@scope/pkg/sub/path'"))).toBe(
			'@scope/pkg'
		);
		expect(missingPackageName(new Error("Cannot find module 'lodash/fp'"))).toBe('lodash');
	});
	it('relative/absolute Pfade und andere Fehler sind kein fehlendes Paket', () => {
		expect(missingPackageName(new Error("Cannot find module './helper'"))).toBeNull();
		expect(missingPackageName(new Error("Cannot find module '/abs/x.js'"))).toBeNull();
		expect(missingPackageName(new Error("Cannot find module 'C:\\x\\y.js'"))).toBeNull();
		expect(missingPackageName(new Error("Cannot find module 'node:fs'"))).toBeNull();
		expect(missingPackageName(new Error('Unexpected token'))).toBeNull();
		expect(missingPackageName('kaputt')).toBeNull();
	});
});

describe('loadBuiltInModules', () => {
	it('fehlendes Paket → nur dieses Modul defekt, die anderen laden, Abhängige fallen mit raus', async () => {
		await loadBuiltInModules([
			entry('ml-good', async () => ({ default: definition('ml-good') })),
			entry('ml-missing', async () => {
				throw new Error("Cannot find package '@tiptap/markdown' from '/gen/x/build/chunk.js'");
			}),
			entry('ml-user', async () => ({ default: definition('ml-user', ['ml-missing']) })),
			entry('ml-throws', async () => {
				throw new TypeError('x is not a function');
			})
		]);
		excludeUnresolvableModules();

		expect(getDefinition('ml-good')).toBeDefined();
		expect(getDefinition('ml-missing')).toBeUndefined();
		expect(getDefinition('ml-user')).toBeUndefined();

		const broken = Object.fromEntries(brokenModules().map((b) => [b.id, b.reason]));
		expect(broken['ml-missing']).toContain('@tiptap/markdown');
		expect(broken['ml-missing']).toContain('npm');
		expect(broken['ml-user']).toContain('ml-missing');
		expect(broken['ml-throws']).toContain('x is not a function');
		expect(broken['ml-good']).toBeUndefined();
	});

	it('module.ts ohne Default-Export → defekt (keine Moduldefinition)', async () => {
		await loadBuiltInModules([entry('ml-good', async () => ({}))]);
		expect(getDefinition('ml-good')).toBeUndefined();
		expect(brokenModules().find((b) => b.id === 'ml-good')?.reason).toMatch(
			/keine Moduldefinition/
		);
	});

	it('bereits registriertes Modul bleibt bei einem erneuten Lauf unverändert', async () => {
		const def = definition('ml-good');
		await loadBuiltInModules([entry('ml-good', async () => ({ default: def }))]);
		await loadBuiltInModules([
			entry('ml-good', async () => {
				throw new Error("Cannot find package 'yjs'");
			})
		]);
		expect(getDefinition('ml-good')).toBe(def);
		expect(brokenModules().find((b) => b.id === 'ml-good')).toBeUndefined();
	});
});
