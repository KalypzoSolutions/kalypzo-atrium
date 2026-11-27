/**
 * Modul-Compiler: Umschreiben der Host-Importe (`atrium-host:<schlüssel>`) auf die Registry des Core.
 * Prüft die Formen, die Rolldown für externe Importe erzeugt, und führt das Ergebnis gegen eine Test-Registry aus.
 */
import { describe, expect, it } from 'bun:test';
import { createHost } from '$lib/host/registry';
import { rewriteHostImports } from '../../scripts/module-compiler/rewrite.mjs';

/**
 * Umgeschriebenen Code mit einer Registry aus festen Namespaces ausführen; `inside` läuft, solange die Test-Registry
 * aktiv ist (für Code, der erst später auf die Registry zugreift, z. B. dynamische Importe)
 */
async function run(
	code: string,
	namespaces: Record<string, Record<string, unknown>>,
	inside?: (m: Record<string, unknown>) => Promise<void>
) {
	const h = createHost(
		Object.fromEntries(Object.entries(namespaces).map(([k, v]) => [k, async () => v])),
		'abi-test'
	);
	await h.preload(Object.keys(namespaces));
	const prev = globalThis.__atriumHost;
	globalThis.__atriumHost = h;
	try {
		const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
		const m = (await import(url)) as Record<string, unknown>;
		await inside?.(m);
		return m;
	} finally {
		globalThis.__atriumHost = prev;
	}
}

describe('rewriteHostImports', () => {
	it('Namespace-, benannte, Default- und Seiteneffekt-Importe', async () => {
		const src = [
			`import * as $ from "atrium-host:svelte/internal/client";`,
			`import { onMount, tick as nextTick } from "atrium-host:svelte";`,
			`import Btn, { variant } from "atrium-host:lib:components/ui/button/index.ts";`,
			`import "atrium-host:svelte/internal/disclose-version";`,
			`import { local } from "./chunks/own.js";`,
			`export const out = [$.tag, onMount(), nextTick(), Btn, variant];`
		].join('\n');
		const { code, used } = rewriteHostImports(src);
		expect(code).not.toContain('atrium-host:');
		expect(code).toContain('import { local } from "./chunks/own.js";');
		expect(code).toContain(`globalThis.__atriumHost.get("svelte", ["onMount","tick"])`);
		expect([...used.keys()].sort()).toEqual([
			'lib:components/ui/button/index.ts',
			'svelte',
			'svelte/internal/client',
			'svelte/internal/disclose-version'
		]);
		expect([...used.get('lib:components/ui/button/index.ts')!].sort()).toEqual([
			'default',
			'variant'
		]);

		const withoutLocal = code.replace('import { local } from "./chunks/own.js";', '');
		const m = await run(withoutLocal, {
			'svelte/internal/client': { tag: 'T' },
			svelte: { onMount: () => 'mounted', tick: () => 'ticked' },
			'lib:components/ui/button/index.ts': { default: 'BTN', variant: 'v' },
			'svelte/internal/disclose-version': {}
		});
		expect(m.out).toEqual(['T', 'mounted', 'ticked', 'BTN', 'v']);
	});

	it('Re-Export und dynamischer Import', async () => {
		const src = [
			`export { toast, toast as notify } from "atrium-host:svelte-sonner";`,
			`export async function later() { const m = await import("atrium-host:lib:sdk/dates.ts"); return m.today(); }`
		].join('\n');
		const { code, used } = rewriteHostImports(src);
		expect(code).not.toContain('atrium-host:');
		expect([...used.get('svelte-sonner')!]).toEqual(['toast']);
		expect(code).toContain(`get("svelte-sonner", ["toast"])`);
		let later = '';
		const m = await run(
			code,
			{
				'svelte-sonner': { toast: 'TOAST' },
				'lib:sdk/dates.ts': { today: () => '2026-11-26' }
			},
			async (mod) => {
				later = await (mod.later as () => Promise<string>)();
			}
		);
		expect(m.toast).toBe('TOAST');
		expect(m.notify).toBe('TOAST');
		expect(later).toBe('2026-11-26');
	});

	it('fehlender Export → klarer Fehler beim Laden', async () => {
		const { code } = rewriteHostImports(
			`import { gone } from "atrium-host:svelte"; export { gone };`
		);
		await expect(run(code, { svelte: { onMount: () => 0 } })).rejects.toThrow(
			/Host-Modul „svelte“ hat keinen Export gone/
		);
	});

	it('export * aus der Host-ABI wird abgelehnt, Code ohne Host-Importe bleibt unverändert', () => {
		expect(() => rewriteHostImports(`export * from "atrium-host:svelte";`)).toThrow(
			/export \* from 'svelte'/
		);
		const plain = `import x from "./a.js"; export default x;`;
		expect(rewriteHostImports(plain).code).toBe(plain);
	});
});
