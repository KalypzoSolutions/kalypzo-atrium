/**
 * Modulgrenzen (#44) und Core-Interna (#47): Die ESLint-Regeln aus `eslint.config.js` schlagen bei verbotenen
 * Importen/Zugriffen in `<Modulverzeichnis>/<id>/**` an; ein Quelltext-Scan stellt sicher, dass fremde Module nur als
 * `import type … /contract` verwendet werden. Generisch über die installierten Module (Fachmodule oder Fixtures):
 * `A` = eigenes Modul, `B`/`C` = fremde Module.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { moduleIds, modulesDir } from '../../tools/modules-dir.js';

const ROOT = process.cwd();
const MODULES = modulesDir();
const BASE = relative(ROOT, MODULES).replace(/\\/g, '/');
const [A, B, C] = moduleIds(MODULES) as [string, string, string];

const eslint = new ESLint({ cwd: ROOT });

async function lint(code: string, file = `${BASE}/${A}/__boundary-fixture.ts`) {
	const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
	return (result?.messages ?? []).filter((m) =>
		['@typescript-eslint/no-restricted-imports', 'no-restricted-syntax'].includes(m.ruleId ?? '')
	);
}

describe('ESLint: Modulgrenzen (#44)', () => {
	it('mindestens drei Module installiert (sonst greift der Test nicht)', () => {
		expect(C).toBeTruthy();
	});

	it('verbietet Laufzeit- und Typimporte aus internen Dateien fremder Module', async () => {
		const msgs = await lint(
			[
				`import { listSelectionInput } from '$modules/${B}/schemas';`,
				`import type { Member } from '$modules/${B}/schemas';`,
				'export const x = [listSelectionInput] as unknown as Member;'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([1, 2]);
	});

	it('erlaubt den Vertrag fremder Module nur als import type', async () => {
		const msgs = await lint(
			[
				`import type { BService } from '$modules/${B}/contract';`,
				`import { something } from '$modules/${C}/contract';`,
				'export type X = BService | typeof something;'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([2]);
	});

	it('verbietet relative Pfade in Nachbarmodule, erlaubt eigene Dateien', async () => {
		const msgs = await lint(
			[
				`import { a } from '../${B}/schemas';`,
				`import { b } from '../../${C}/db';`,
				"import { c } from './schemas';",
				`import { d } from '$modules/${A}/schemas';`,
				'export const x = [a, b, c, d];'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([1, 2]);
	});

	it('erlaubt nur die freigegebenen Bibliotheken unter $lib', async () => {
		const msgs = await lint(
			[
				"import { core } from '$lib/sdk/server';",
				"import { Button } from '$lib/components/ui/button';",
				"import { formatEuro } from '$lib/components/layout/money';",
				"import { FormRenderer } from '$lib/components/forms';",
				"import type { FieldDefinition } from '$lib/forms';",
				"import { composeListBlocks } from '$lib/pdf-lists';",
				"import { cn } from '$lib/utils';",
				"import { x } from '$lib/server/core';",
				"import { y } from '$lib/backup/contract';",
				"import { z } from '$lib/components/dashboard/Foo.svelte';",
				'export const all = [core, Button, formatEuro, FormRenderer, composeListBlocks, cn, x, y, z];',
				'export type F = FieldDefinition;'
			].join('\n')
		);
		expect([...new Set(msgs.map((m) => m.line))]).toEqual([8, 9, 10]);
	});

	it('Tests im Modul (tests/) dürfen andere Module und $testing nutzen', async () => {
		const msgs = await lint(
			[
				`import modB from '$modules/${B}/module';`,
				"import { useTestDatabase } from '$testing';",
				'export const x = [modB, useTestDatabase];'
			].join('\n'),
			`${BASE}/${A}/tests/integration/__fixture.test.ts`
		);
		expect(msgs).toEqual([]);
	});
});

describe('ESLint: Core-Interna in Modulen (#47)', () => {
	it('meldet core.database.db, core.system, modules.enable/disable, auth.instance', async () => {
		const msgs = await lint(
			[
				"import { core } from '$lib/sdk/server';",
				'export const a = core.database.db;',
				'export const b = core.system;',
				'export const c = core.modules.enable;',
				'export const d = core.modules.disable;',
				'export const e = core.auth.instance;',
				'export const ok1 = core.modules.useOptional;',
				"export const ok2 = core.settings.get('core.system.name');"
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([2, 3, 4, 5, 6]);
	});

	it('meldet forModule mit fremder Modul-ID als Literal', async () => {
		const msgs = await lint(
			[
				"import { core } from '$lib/sdk/server';",
				`const MODULE_ID = '${A}';`,
				`export const a = core.database.forModule('${C}');`,
				`export const b = core.crypto.forModule('${B}');`,
				`export const ok1 = core.database.forModule('${A}');`,
				'export const ok2 = core.crypto.forModule(MODULE_ID);'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([3, 4]);
	});
});

describe('Quelltext: fremde Module nur über import type … /contract', () => {
	function files(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory()
				? e.name === 'tests' || e.name === 'node_modules'
					? []
					: files(join(dir, e.name))
				: /\.(ts|svelte)$/.test(e.name)
					? [join(dir, e.name)]
					: []
		);
	}

	it('keine Verstöße', () => {
		const found: string[] = [];
		const re = /import\s+(type\s+)?[^;]*?\sfrom\s*['"]\$modules\/([^/'"]+)([^'"]*)['"]/g;
		for (const id of moduleIds(MODULES)) {
			for (const file of files(join(MODULES, id))) {
				const rel = relative(MODULES, file).split(sep).join('/');
				const src = readFileSync(file, 'utf8');
				for (const m of src.matchAll(re)) {
					const [, isType, mod, rest] = m;
					if (mod === id) continue;
					if (isType && rest === '/contract') continue;
					found.push(`${rel} → $modules/${mod}${rest}`);
				}
			}
		}
		expect(found).toEqual([]);
	});
});
