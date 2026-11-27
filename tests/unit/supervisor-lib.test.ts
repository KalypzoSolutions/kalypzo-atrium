/**
 * Supervisor – reine Teile: Inhaltshash wie in der Vorschau, Planung der Bundle-Ablage (welche Module kompiliert,
 * wiederverwendet, entfernt oder nach einem Core-Update neu kompiliert werden) und Verhalten bei Abstürzen.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { contentHash, readModuleArchive } from '$lib/server/core/modules/install/archive';
import {
	bundleBuildId,
	planCompile,
	readActive,
	staleModules,
	unreferencedBuilds,
	writeJsonAtomic,
	type LockEntry
} from '../../scripts/supervisor/bundles.mjs';
import { contentHashOfDir, crashDecision, moduleFolders } from '../../scripts/supervisor/lib.mjs';
import { filesOf, makeZip } from '../helpers/module-zip';

const FIXTURES = join(__dirname, '..', 'fixtures', 'modules');
const tmp = mkdtempSync(join(tmpdir(), 'atrium-sup-'));
afterAll(() => {
	if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const ABI = 'abi-0123456789abcdef';
const NEW_ABI = 'abi-fedcba9876543210';
const hash = (c: string) => `sha256-${c.repeat(64).slice(0, 64)}`;
const entry = (c: string, version = '1.0.0'): LockEntry => ({
	version,
	sourceType: 'github',
	source: {},
	commit: 'x',
	contentHash: hash(c)
});

function moduleDir(id: string) {
	const dir = join(tmp, 'mods', id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'atrium-module.json'), JSON.stringify({ schema: 1, id, name: id }));
	writeFileSync(join(dir, 'module.ts'), 'export default {};');
	return dir;
}

/** Bundle mit meta.json in eine Ablage legen */
function bundle(root: string, id: string, c: string, abi: string) {
	const build = bundleBuildId(hash(c), abi);
	mkdirSync(join(root, id, build), { recursive: true });
	writeFileSync(
		join(root, id, build, 'meta.json'),
		JSON.stringify({ id, abi, contentHash: hash(c) })
	);
	return `${id}/${build}`;
}

describe('contentHashOfDir', () => {
	it('stimmt mit dem Inhaltshash der Vorschau (Archiv) überein', () => {
		const dir = join(FIXTURES, 'fx-board');
		const files = readModuleArchive(makeZip(filesOf(dir), 'fx-board/'));
		expect(contentHashOfDir(dir)).toBe(contentHash(files));
	});

	it('ignoriert node_modules; moduleFolders findet nur Ordner mit module.ts', () => {
		const dir = moduleDir('hash-a');
		const before = contentHashOfDir(dir);
		mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
		writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'x');
		expect(contentHashOfDir(dir)).toBe(before);
		mkdirSync(join(tmp, 'mods', 'ohne-module-ts'), { recursive: true });
		expect(moduleFolders(join(tmp, 'mods'))).toEqual(['hash-a']);
	});
});

describe('bundleBuildId', () => {
	it('aus Inhalt und ABI, gleiche Eingabe → gleicher Ordner', () => {
		expect(bundleBuildId(hash('a'), ABI)).toBe('aaaaaaaaaaaa-01234567');
		expect(bundleBuildId(hash('a'), ABI)).toBe(bundleBuildId(hash('a'), ABI));
		expect(bundleBuildId(hash('a'), NEW_ABI)).not.toBe(bundleBuildId(hash('a'), ABI));
	});
	it('lehnt unbrauchbare Kennungen ab (nie ein leerer oder fremder Pfad)', () => {
		expect(() => bundleBuildId('', ABI)).toThrow();
		expect(() => bundleBuildId('sha256-../../x', ABI)).toThrow();
		expect(() => bundleBuildId(hash('a'), 'abi-')).toThrow();
	});
});

describe('planCompile', () => {
	const root = join(tmp, 'plan');
	mkdirSync(root, { recursive: true });
	const aDir = bundle(root, 'mod-a', 'a', ABI);
	const bDir = bundle(root, 'mod-b', 'b', ABI);
	const active = {
		version: 1 as const,
		modules: { 'mod-a': { dir: aDir }, 'mod-b': { dir: bDir } }
	};
	const lock = {
		lockVersion: 1 as const,
		core: '2.0.0',
		modules: { 'mod-a': entry('a'), 'mod-b': entry('b') }
	};

	it('Installieren, Aktualisieren und Entfernen in einem Auftrag', () => {
		const plan = planCompile({
			bundlesDir: root,
			active,
			lock,
			request: {
				modules: { 'mod-a': entry('c', '1.1.0'), 'mod-new': entry('d') },
				remove: ['mod-b']
			},
			abi: ABI,
			stagingDir: join(tmp, 'staging', 'p1')
		});
		expect(Object.keys(plan.next.modules).sort()).toEqual(['mod-a', 'mod-new']);
		expect(plan.next.modules['mod-a']!.dir).toBe(`mod-a/${bundleBuildId(hash('c'), ABI)}`);
		expect(plan.nextLock.modules['mod-a']!.version).toBe('1.1.0');
		expect(plan.nextLock.modules['mod-b']).toBeUndefined();
		expect(plan.jobs.map((j) => [j.id, j.requested, j.reuse])).toEqual([
			['mod-a', true, false],
			['mod-new', true, false]
		]);
		expect(plan.jobs[0]!.source).toBe(join(tmp, 'staging', 'p1', 'modules', 'mod-a'));
		// Ausgangszustand bleibt unverändert
		expect(active.modules['mod-b']).toBeDefined();
	});

	it('gleicher Inhalt für dieselbe ABI wird wiederverwendet, nicht neu kompiliert', () => {
		const plan = planCompile({
			bundlesDir: root,
			active,
			lock,
			request: { modules: { 'mod-a': entry('a') } },
			abi: ABI,
			stagingDir: join(tmp, 'staging', 'p2')
		});
		expect(plan.jobs).toEqual([expect.objectContaining({ id: 'mod-a', reuse: true })]);
		expect(plan.next).toEqual(active);
	});

	it('Neukompilieren nach Core-Update nimmt die gespeicherte Quelle', () => {
		expect(staleModules(root, active, NEW_ABI)).toEqual(['mod-a', 'mod-b']);
		expect(staleModules(root, active, ABI)).toEqual([]);
		const plan = planCompile({
			bundlesDir: root,
			active,
			lock,
			request: {},
			recompile: ['mod-a', 'mod-unbekannt'],
			abi: NEW_ABI,
			stagingDir: null
		});
		expect(plan.jobs).toEqual([
			expect.objectContaining({
				id: 'mod-a',
				requested: false,
				reuse: false,
				source: join(root, aDir, 'src')
			})
		]);
		expect(plan.next.modules['mod-a']!.dir).toBe(`mod-a/${bundleBuildId(hash('a'), NEW_ABI)}`);
		expect(plan.next.modules['mod-b']).toEqual(active.modules['mod-b']);
	});

	it('Auftrag mit Modulen, aber ohne Staging → Fehler', () => {
		expect(() =>
			planCompile({
				bundlesDir: root,
				active,
				lock,
				request: { modules: { 'mod-a': entry('z') } },
				abi: ABI,
				stagingDir: null
			})
		).toThrow(/Staging/);
	});
});

describe('Ablage lesen und aufräumen', () => {
	it('fehlende/kaputte active.json → leer; unbenutzte Builds werden gefunden', () => {
		const root = join(tmp, 'store');
		mkdirSync(root, { recursive: true });
		expect(readActive(root).modules).toEqual({});
		writeFileSync(join(root, 'active.json'), '{kaputt');
		expect(readActive(root).modules).toEqual({});
		const keep = bundle(root, 'mod-a', 'a', ABI);
		const old = bundle(root, 'mod-a', 'b', ABI);
		const prev = bundle(root, 'mod-b', 'c', ABI);
		mkdirSync(join(root, 'mod-a', `${bundleBuildId(hash('e'), ABI)}.tmp-abc123`), {
			recursive: true
		});
		writeJsonAtomic(join(root, 'active.json'), { version: 1, modules: { 'mod-a': { dir: keep } } });
		expect(readActive(root).modules['mod-a']!.dir).toBe(keep);
		const unused = unreferencedBuilds(root, [
			readActive(root),
			{ version: 1, modules: { 'mod-b': { dir: prev } } }
		]);
		expect(unused).toContain(old);
		expect(unused.some((d) => d.includes('.tmp-'))).toBe(true);
		expect(unused).not.toContain(keep);
		expect(unused).not.toContain(prev);
	});
});

describe('crashDecision (Abstürze der App)', () => {
	const base = { current: 'active', previous: 'prev', busy: false };
	it('bis zum Limit einfach neu starten', () => {
		expect(crashDecision({ ...base, crashes: 1 })).toEqual({ action: 'restart', delayMs: 2000 });
		expect(crashDecision({ ...base, crashes: 5 }).action).toBe('restart');
	});
	it('danach Rückfall auf die vorige Liste bzw. ganz ohne installierte Module, zuletzt Beenden', () => {
		expect(crashDecision({ ...base, crashes: 6 }).action).toBe('fallback');
		expect(crashDecision({ ...base, previous: null, crashes: 6 }).action).toBe('fallback');
		expect(crashDecision({ current: null, previous: null, busy: false, crashes: 6 }).action).toBe(
			'exit'
		);
	});
	it('läuft ein Auftrag, kein Rückfall und kein Beenden – Neustart mit wachsender Pause (max. 30 s)', () => {
		const at = (crashes: number) => crashDecision({ ...base, busy: true, crashes });
		expect(at(6)).toEqual({ action: 'restart', delayMs: 4000, waiting: true });
		expect(at(7).delayMs).toBe(8000);
		expect(at(9).delayMs).toBe(30_000);
		expect(at(50).delayMs).toBe(30_000);
		expect(crashDecision({ current: null, previous: null, busy: true, crashes: 20 }).action).toBe(
			'restart'
		);
	});
});
