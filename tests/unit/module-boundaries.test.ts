/**
 * Modulgrenzen (#44) und Core-Interna (#47): Die ESLint-Regeln aus `eslint.config.js` schlagen bei
 * verbotenen Importen/Zugriffen in `src/lib/modules/<id>/**` an; ein Quelltext-Scan stellt sicher, dass
 * fremde Module heute nur als `import type … /contract` verwendet werden (bis auf die offenen Ausnahmen).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MODULES = join(ROOT, 'src', 'lib', 'modules');

const eslint = new ESLint({ cwd: ROOT });

async function lint(code: string, file = 'src/lib/modules/actions/__boundary-fixture.ts') {
	const [result] = await eslint.lintText(code, { filePath: join(ROOT, file) });
	return (result?.messages ?? []).filter((m) =>
		['@typescript-eslint/no-restricted-imports', 'no-restricted-syntax'].includes(m.ruleId ?? '')
	);
}

describe('ESLint: Modulgrenzen (#44)', () => {
	it('verbietet Laufzeit- und Typimporte aus internen Dateien fremder Module', async () => {
		const msgs = await lint(
			[
				"import { listSelectionInput } from '$lib/modules/members/schemas';",
				"import type { Member } from '$lib/modules/members/schemas';",
				'export const x = [listSelectionInput] as unknown as Member;'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([1, 2]);
	});

	it('erlaubt den Vertrag fremder Module nur als import type', async () => {
		const msgs = await lint(
			[
				"import type { MembersService } from '$lib/modules/members/contract';",
				"import { type TreasuryService } from '$lib/modules/treasury/contract';",
				"import { something } from '$lib/modules/members/contract';",
				'export type X = MembersService | TreasuryService | typeof something;'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([3]);
	});

	it('verbietet relative Pfade in Nachbarmodule, erlaubt eigene Dateien', async () => {
		const msgs = await lint(
			[
				"import { a } from '../members/schemas';",
				"import { b } from '../../treasury/db';",
				"import { c } from './schemas';",
				"import { d } from '$lib/modules/actions/schemas';",
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

	it('Ausnahme gilt nur für die eingetragene Datei', async () => {
		const code = [
			"import { ACCOUNTING_CATEGORY_LABELS } from '$lib/modules/actions/schemas';",
			"import { x } from '$lib/modules/actions/access';",
			'export const l = [ACCOUNTING_CATEGORY_LABELS, x];'
		].join('\n');
		const open = await lint(code, 'src/lib/modules/treasury/pages/AccountingPage.ts');
		// Andere Dateiendung → keine Ausnahme
		expect(open.map((m) => m.line)).toEqual([1, 2]);
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
				"const MODULE_ID = 'actions';",
				"export const a = core.database.forModule('treasury');",
				"export const b = core.crypto.forModule('members');",
				"export const ok1 = core.database.forModule('actions');",
				'export const ok2 = core.crypto.forModule(MODULE_ID);'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([3, 4]);
	});
});

describe('Quelltext: fremde Module nur über import type … /contract', () => {
	/** Offene Ausnahmen (#44), identisch mit OPEN_BOUNDARY_EXCEPTIONS in eslint.config.js */
	const OPEN = new Set(['treasury/pages/AccountingPage.svelte → $lib/modules/actions/schemas']);

	function files(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
			e.isDirectory()
				? files(join(dir, e.name))
				: /\.(ts|svelte)$/.test(e.name)
					? [join(dir, e.name)]
					: []
		);
	}

	it('keine weiteren Verstöße', () => {
		const found: string[] = [];
		const re = /import\s+(type\s+)?[^;]*?\sfrom\s*['"]\$lib\/modules\/([^/'"]+)([^'"]*)['"]/g;
		for (const file of files(MODULES)) {
			const rel = relative(MODULES, file).split(sep).join('/');
			const own = rel.split('/')[0]!;
			const src = readFileSync(file, 'utf8');
			for (const m of src.matchAll(re)) {
				const [, isType, mod, rest] = m;
				if (mod === own) continue;
				if (isType && rest === '/contract') continue;
				found.push(`${rel} → $lib/modules/${mod}${rest}`);
			}
		}
		expect(found.filter((f) => !OPEN.has(f))).toEqual([]);
	});
});
