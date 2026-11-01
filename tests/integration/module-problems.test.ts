/**
 * Kalypzo Atrium, Phase 2: Nicht lauffähige Module brechen den Start nicht ab, sondern erscheinen als „defekt“;
 * Module mit Zustand in der Datenbank, die nicht mehr installiert sind, als „nicht installiert“.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import {
	getDefinition,
	registerModule,
	resetBrokenModulesForTests,
	unregisterModule
} from '$lib/server/core/modules/registry';
import {
	enableModule,
	isModuleEnabled,
	listModuleProblems,
	listModules,
	syncModules
} from '$lib/server/core/modules/service';
import type { ModuleDefinition } from '$lib/server/core/modules/types';

let close: () => Promise<void>;

const mod = (
	id: string,
	over: Partial<ModuleDefinition['manifest']> = {},
	pkg?: Record<string, unknown>
): ModuleDefinition => ({
	manifest: {
		id,
		name: `Modul ${id}`,
		version: '1.0.0',
		dependencies: [],
		permissions: [],
		navigation: [],
		...over
	},
	...(pkg
		? {
				package: {
					schema: 1,
					id,
					name: `Modul ${id}`,
					version: over.version ?? '1.0.0',
					core: '>=2.0.0-0 <3.0.0',
					dependencies: Object.fromEntries(
						(over.dependencies ?? []).map((d) => [d, { version: '^1.0.0' }])
					),
					...pkg
				}
			}
		: {})
});

beforeAll(async () => {
	close = (await useTestDatabase()).close;
	resetBrokenModulesForTests();
});
afterAll(async () => {
	for (const id of ['pb-base', 'pb-user', 'pb-orphan', 'pb-old-core', 'pb-wrong-range'])
		unregisterModule(id);
	resetBrokenModulesForTests();
	await close();
});

describe('nicht lauffähige Module', () => {
	it('fehlende Abhängigkeit, unpassende Version und Core-Version → defekt, Start läuft weiter', async () => {
		registerModule(mod('pb-base', { version: '1.0.0' }, {}));
		registerModule(mod('pb-user', { dependencies: ['pb-missing'] }));
		registerModule(mod('pb-old-core', {}, { core: '^1.0.0' }));
		registerModule(
			mod(
				'pb-wrong-range',
				{ dependencies: ['pb-base'] },
				{ dependencies: { 'pb-base': { version: '^2.0.0' } } }
			)
		);
		await expect(syncModules()).resolves.toBeUndefined();

		expect(getDefinition('pb-base')).toBeDefined();
		const problems = await listModuleProblems();
		const reason = (id: string) => problems.find((p) => p.id === id);
		expect(reason('pb-user')).toMatchObject({ kind: 'broken' });
		expect(reason('pb-user')?.reason).toMatch(/„pb-missing“ fehlt/);
		expect(reason('pb-old-core')?.reason).toMatch(/Braucht Core \^1\.0\.0/);
		expect(reason('pb-wrong-range')?.reason).toMatch(/\^2\.0\.0, vorhanden ist 1\.0\.0/);
		expect((await listModules()).map((m) => m.manifest.id)).not.toContain('pb-user');
	});

	it('Manifest und atrium-module.json müssen übereinstimmen', () => {
		expect(() =>
			registerModule(mod('pb-mismatch', { version: '1.1.0' }, { version: '1.0.0' }))
		).toThrow(/passt nicht zum Manifest \(version/);
		expect(getDefinition('pb-mismatch')).toBeUndefined();
	});

	it('aktiviertes, dann entferntes Modul erscheint als „nicht installiert“ und gilt nicht als aktiv', async () => {
		await bootstrapAdmin('problems@example.test', 'Sehr-Geheim-2026!');
		const [u] = await getDb()
			.select()
			.from(schema.user)
			.where(eq(schema.user.email, 'problems@example.test'));
		const adminId = u!.id;
		registerModule(mod('pb-orphan'));
		await syncModules();
		await enableModule((await contextForUser(adminId))!.ctx, 'pb-orphan');
		expect(await isModuleEnabled('pb-orphan')).toBe(true);

		unregisterModule('pb-orphan');
		expect(await isModuleEnabled('pb-orphan')).toBe(false);
		const orphan = (await listModuleProblems()).find((p) => p.id === 'pb-orphan');
		expect(orphan).toMatchObject({ kind: 'missing', enabled: true, version: '1.0.0' });
	});
});
