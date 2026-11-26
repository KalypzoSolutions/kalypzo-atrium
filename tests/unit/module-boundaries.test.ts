/**
 * Modulgrenzen (#44) und Core-Interna (#47): Der Prüfer `tools/module-boundaries.ts` (früher ESLint) meldet verbotene
 * Importe/Zugriffe in `<Modulverzeichnis>/<id>/**`; danach müssen alle installierten Module sauber sein. Generisch über
 * die installierten Module (Fachmodule oder Fixtures): `A` = eigenes Modul, `B`/`C` = fremde Module.
 */

import { describe, expect, it } from 'bun:test';
import { checkAllModules, checkModuleSource, scriptBlocks } from '../../tools/module-boundaries';
import { moduleIds, modulesDir } from '../../tools/modules-dir.js';

const MODULES = modulesDir();
const IDS = moduleIds(MODULES);
const [A, B, C] = IDS as [string, string, string];

function lint(code: string, file = `${A}/__boundary-fixture.ts`) {
	return checkModuleSource(code, { file, ownId: file.split('/')[0]!, ids: IDS, dir: MODULES });
}

describe('Modulgrenzen (#44)', () => {
	it('mindestens drei Module installiert (sonst greift der Test nicht)', () => {
		expect(C).toBeTruthy();
	});

	it('verbietet Laufzeit- und Typimporte aus internen Dateien fremder Module', () => {
		const msgs = lint(
			[
				`import { listSelectionInput } from '$modules/${B}/schemas';`,
				`import type { Member } from '$modules/${B}/schemas';`,
				'export const x = [listSelectionInput] as unknown as Member;'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([1, 2]);
	});

	it('erlaubt den Vertrag fremder Module nur als import type', () => {
		const msgs = lint(
			[
				`import type { BService } from '$modules/${B}/contract';`,
				`import { something } from '$modules/${C}/contract';`,
				'export type X = BService | typeof something;'
			].join('\n')
		);
		expect(msgs.map((m) => m.line)).toEqual([2]);
	});

	it('verbietet relative Pfade in Nachbarmodule, erlaubt eigene Dateien', () => {
		const msgs = lint(
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

	it('erlaubt nur die freigegebenen Bibliotheken unter $lib', () => {
		const msgs = lint(
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

	it('prüft auch .svelte-Dateien (Script-Blöcke, Zeilen der Datei)', () => {
		const msgs = lint(
			[
				'<script lang="ts">',
				"\timport { x } from '$lib/server/core';",
				'</script>',
				'',
				'<p>{x}</p>'
			].join('\n'),
			`${A}/pages/__fixture.svelte`
		);
		expect(msgs.map((m) => m.line)).toEqual([2]);
	});

	it('erkennt Script-Blöcke mit `>` in Attributwerten (generics)', () => {
		const code = [
			'<script module lang="ts">',
			'\texport type Foo<T> = T;',
			'</script>',
			'',
			'<script',
			'\tlang="ts"',
			'\tgenerics="T extends Foo<Bar>, U extends \'a>b\'"',
			'>',
			"\timport { core } from '$lib/sdk/server';",
			"\timport { x } from '$lib/server/core';",
			'\texport const a = core.system;',
			'</script>',
			'',
			'<p>{x}</p>'
		].join('\n');
		// Der Block beginnt erst nach dem echten Tag-Ende, nicht am `>` im Attribut
		expect(scriptBlocks('x.svelte', code)).toEqual([
			{ code: '\n\texport type Foo<T> = T;\n', lineOffset: 0 },
			{ code: code.slice(code.indexOf('\n>') + 2, code.lastIndexOf('</script>')), lineOffset: 7 }
		]);
		const msgs = lint(code, `${A}/pages/__generic.svelte`);
		expect(msgs.map((m) => m.line)).toEqual([10, 11]);
	});
});

describe('Core-Interna in Modulen (#47)', () => {
	it('meldet core.database.db, core.system, modules.enable/disable, auth.instance', () => {
		const msgs = lint(
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

	it('meldet forModule mit fremder Modul-ID als Literal', () => {
		const msgs = lint(
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

describe('Installierte Module', () => {
	it('keine Verstöße gegen die Modulgrenzen', () => {
		expect(checkAllModules(MODULES).map((v) => `${v.file}:${v.line} ${v.message}`)).toEqual([]);
	});
});
