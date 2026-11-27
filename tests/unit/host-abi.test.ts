/**
 * Host-ABI (Umbau „Module ohne App-Neubau“, Phase 1): Liste der geteilten Pakete/`$lib`-Dateien, Schlüssel je Datei,
 * ABI-Kennung und die Registry, über die separat kompilierte Modul-Bundles die Instanzen des Core bekommen.
 */
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import { abi, host } from 'virtual:atrium-host/server';
import { createHost } from '$lib/host/registry';
import {
	CLIENT_SHARED_LIB,
	HOST_PACKAGES,
	LIB_DIR,
	allowedLibFiles,
	hostAbiHash,
	hostEntries,
	hostKeyForFile,
	hostLibFiles,
	hostPackageTarget
} from '../../tools/host-abi.js';

describe('Host-ABI-Liste', () => {
	it('Schlüssel sind eindeutig, Ziele der $lib-Einträge existieren', () => {
		for (const side of ['client', 'server'] as const) {
			const entries = hostEntries(side);
			expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
			for (const e of entries.filter((x) => x.key.startsWith('lib:')))
				expect(existsSync(e.target), e.target).toBe(true);
		}
	});

	it('Server teilt alle freigegebenen Dateien, Browser nur die mit Zustand', () => {
		const client = hostLibFiles('client');
		const server = hostLibFiles('server');
		expect(server).toEqual(allowedLibFiles());
		for (const f of ['sdk/server/index.ts', 'utils.ts', 'components/ui/button/index.ts'])
			expect(server, f).toContain(f);
		// alle Einträge der Browser-Liste existieren (keine stillen Tippfehler)
		expect(client).toEqual([...CLIENT_SHARED_LIB].sort());
		expect(client).toContain('i18n/index.ts');
		expect(client).toContain('components/ui/field/context.ts');
		expect(client.some((f) => f.startsWith('sdk/server/'))).toBe(false);
		expect(client).not.toContain('components/ui/button/index.ts');
		expect(HOST_PACKAGES.client).toContain('svelte/internal/client');
		expect(HOST_PACKAGES.server).toContain('svelte/internal/server');
		expect(HOST_PACKAGES.client).not.toContain('drizzle-orm');
		// zod im Browser nicht geteilt (voller Namespace = +278 KB je Seite), Toasts nur über `toast`
		expect(HOST_PACKAGES.client).not.toContain('zod');
		expect(HOST_PACKAGES.server).toContain('zod');
		expect(hostPackageTarget('svelte-sonner', 'client')).toBe(`${LIB_DIR}/host/sonner.ts`);
		expect(hostPackageTarget('svelte-sonner', 'server')).toBe('svelte-sonner');
	});

	it('nur freigegebene Bereiche: keine Core-Interna, keine Tests', () => {
		const all = hostLibFiles('server');
		expect(all.some((f) => f.startsWith('server/'))).toBe(false);
		expect(all.some((f) => f.startsWith('host/'))).toBe(false);
		expect(all.some((f) => /\.(test|d)\.ts$/.test(f))).toBe(false);
	});

	it('hostKeyForFile: Datei → Schlüssel, fremde Dateien → null', () => {
		expect(hostKeyForFile(`${LIB_DIR}/components/ui/button/index.ts`, 'server')).toBe(
			'lib:components/ui/button/index.ts'
		);
		expect(hostKeyForFile(`${LIB_DIR}/components/ui/button/index.ts`, 'client')).toBeNull();
		expect(hostKeyForFile(`${LIB_DIR}/i18n/index.ts`, 'client')).toBe('lib:i18n/index.ts');
		expect(hostKeyForFile(`${LIB_DIR}/sdk/server/index.ts`, 'client')).toBeNull();
		expect(hostKeyForFile(`${LIB_DIR}/sdk/server/index.ts`, 'server')).toBe(
			'lib:sdk/server/index.ts'
		);
		expect(hostKeyForFile(`${LIB_DIR}/server/core/index.ts`, 'server')).toBeNull();
		expect(hostKeyForFile(`${LIB_DIR}/../routes/+layout.svelte`, 'server')).toBeNull();
	});

	it('ABI-Kennung ist stabil und steckt im virtuellen Modul', () => {
		expect(hostAbiHash()).toMatch(/^abi-[0-9a-f]{16}$/);
		expect(hostAbiHash()).toBe(hostAbiHash());
		expect(abi).toBe(hostAbiHash());
	});
});

describe('Registry', () => {
	it('preload + get liefern dieselbe Instanz wie der Core', async () => {
		expect(globalThis.__atriumHost).toBe(host);
		const keys = ['lib:utils.ts', 'lib:sdk/dates.ts', 'lib:sdk/server/index.ts', 'zod', 'svelte'];
		await host.preload(keys);
		expect(host.get('lib:utils.ts')).toBe(await import('$lib/utils'));
		expect(host.get('lib:sdk/dates.ts')).toBe(await import('$lib/sdk/dates'));
		expect(host.get('lib:sdk/server/index.ts')).toBe(await import('$lib/sdk/server'));
		expect(host.get('zod')).toBe(await import('zod'));
		expect(host.get('svelte')).toBe(await import('svelte'));
	});

	it('unbekannte oder nicht vorgeladene Schlüssel → klare Fehler, Loader nur einmal', async () => {
		let calls = 0;
		const h = createHost(
			{
				a: async () => {
					calls++;
					return { x: 1 };
				},
				b: async () => ({ y: 2 })
			},
			'abi-test'
		);
		expect(h.abi).toBe('abi-test');
		expect(await h.keys()).toEqual(['a', 'b']);
		expect(() => h.get('a')).toThrow(/nicht vorgeladen/);
		expect(() => h.get('zz')).toThrow(/Nicht Teil der Host-ABI: zz/);
		await expect(h.preload(['a', 'zz', 'yy'])).rejects.toThrow(/zz, yy/);
		await Promise.all([h.preload(['a']), h.preload(['a', 'b'])]);
		await h.preload(['a']);
		expect(calls).toBe(1);
		expect(h.get('a')).toEqual({ x: 1 });
		expect(h.get('a', ['x'])).toEqual({ x: 1 });
		expect(() => h.get('a', ['x', 'gone', 'weg'])).toThrow(/keinen Export gone, weg/);
	});

	it('Loader-Liste wird erst beim ersten Bedarf und nur einmal geladen', async () => {
		let mapCalls = 0;
		const h = createHost(async () => {
			mapCalls++;
			return { a: async () => ({ v: 1 }) };
		}, 'abi-lazy');
		expect(mapCalls).toBe(0);
		expect(() => h.get('a')).toThrow(/nicht vorgeladen/);
		await Promise.all([h.preload(['a']), h.keys()]);
		expect(mapCalls).toBe(1);
		expect(h.get('a')).toEqual({ v: 1 });
		expect(() => h.get('zz')).toThrow(/Nicht Teil der Host-ABI/);
	});

	it('jeder Schlüssel der Server-Liste gehört zur Host-ABI und die Gruppe liefert die echte Datei', async () => {
		const keys = await host.keys();
		expect(keys).toEqual(
			hostEntries('server')
				.map((e) => e.key)
				.sort()
		);
		await host.preload(['lib:sdk/csv.ts', 'lib:sdk/types/sharing.ts']);
		expect(host.get('lib:sdk/csv.ts')).toBe(await import('$lib/sdk/csv'));
		expect(host.get('lib:sdk/types/sharing.ts')).toBe(await import('$lib/sdk/types/sharing'));
	});

	it('fehlgeschlagenes Laden lässt sich wiederholen', async () => {
		let fail = true;
		const h = createHost(
			{
				a: async () => {
					if (fail) throw new Error('weg');
					return { ok: true };
				}
			},
			'abi-test'
		);
		await expect(h.preload(['a'])).rejects.toThrow('weg');
		fail = false;
		await h.preload(['a']);
		expect(h.get('a')).toEqual({ ok: true });
	});
});
