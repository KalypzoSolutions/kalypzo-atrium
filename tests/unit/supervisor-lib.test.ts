/**
 * Supervisor (Kalypzo Atrium, Phase 6) – reine Teile: Inhaltshash wie in der Vorschau, Lock-Datei, Modul-Pakete.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { contentHash, readModuleArchive } from '$lib/server/core/modules/install/archive';
import {
	contentHashOfDir,
	coreChanged,
	dedupeModulePackages,
	mergeLock,
	moduleFolders,
	modulePackagesFor,
	Supervisor,
	type LockEntry
} from '../../scripts/supervisor/lib.mjs';
import { filesOf, makeZip } from '../helpers/module-zip';

const FIXTURES = join(__dirname, '..', 'fixtures', 'modules');
const tmp = mkdtempSync(join(tmpdir(), 'atrium-sup-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function moduleDir(id: string, npm: Record<string, string> = {}, version = '1.0.0') {
	const dir = join(tmp, 'mods', id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, 'atrium-module.json'),
		JSON.stringify({ schema: 1, id, name: id, version, core: '*', npm })
	);
	writeFileSync(join(dir, 'module.ts'), 'export default {};');
	return dir;
}

describe('contentHashOfDir', () => {
	it('stimmt mit dem Inhaltshash der Vorschau (Archiv) überein', () => {
		const dir = join(FIXTURES, 'fx-board');
		const files = readModuleArchive(makeZip(filesOf(dir), 'fx-board/'));
		expect(contentHashOfDir(dir)).toBe(contentHash(files));
	});

	it('ignoriert node_modules', () => {
		const dir = moduleDir('hash-a');
		const before = contentHashOfDir(dir);
		mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
		writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'x');
		expect(contentHashOfDir(dir)).toBe(before);
	});
});

describe('mergeLock', () => {
	it('übernimmt den Auftrag, ergänzt fehlende Module als builtin und entfernt verschwundene', () => {
		const mods = join(tmp, 'mods');
		moduleDir('lock-a');
		moduleDir('lock-b', {}, '2.0.0');
		const prev: { modules: Record<string, LockEntry> } = {
			modules: {
				'lock-a': {
					version: '0.9.0',
					sourceType: 'github',
					source: {},
					commit: 'x',
					contentHash: 'h'
				},
				gone: { version: '1.0.0', sourceType: 'github', source: {}, commit: 'y', contentHash: 'z' }
			}
		};
		const req: { modules: Record<string, LockEntry>; remove: string[] } = {
			modules: {
				'lock-a': {
					version: '1.0.0',
					sourceType: 'upload',
					source: { fileName: 'a.zip' },
					commit: null,
					contentHash: 'neu'
				}
			},
			remove: []
		};
		const lock = mergeLock(prev, req, mods, '2.0.0-pre.1');
		expect(lock.core).toBe('2.0.0-pre.1');
		expect(lock.modules['lock-a']).toMatchObject({ version: '1.0.0', sourceType: 'upload' });
		expect(lock.modules['lock-b']).toMatchObject({ version: '2.0.0', sourceType: 'builtin' });
		expect(lock.modules['lock-b']!.contentHash).toMatch(/^sha256-/);
		expect(lock.modules.gone).toBeUndefined();
	});
});

describe('modulePackagesFor', () => {
	it('nur Pakete, die der Core nicht mitbringt; Versionskonflikt wirft', () => {
		const dir = join(tmp, 'pk');
		mkdirSync(dir, { recursive: true });
		const add = (id: string, npm: Record<string, string>) => {
			mkdirSync(join(dir, id), { recursive: true });
			writeFileSync(join(dir, id, 'module.ts'), 'x');
			writeFileSync(join(dir, id, 'atrium-module.json'), JSON.stringify({ id, npm }));
		};
		add('pa', { 'left-pad': '1.3.0', zod: '4.0.0' });
		add('pb', { 'left-pad': '1.3.0', 'is-odd': '3.0.1' });
		const core = { dependencies: { zod: '^4.0.0' } };
		expect(moduleFolders(dir)).toEqual(['pa', 'pb']);
		expect(modulePackagesFor(dir, core)).toEqual({ 'is-odd': '3.0.1', 'left-pad': '1.3.0' });
		add('pc', { 'left-pad': '1.2.0' });
		expect(() => modulePackagesFor(dir, core)).toThrow(/verschiedenen Versionen/);
	});
});

describe('dedupeModulePackages', () => {
	const pkg = (root: string, name: string, version: string) => {
		const dir = join(root, 'node_modules', name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }));
	};

	it('entfernt Kopien, die der Core in derselben Hauptversion hat; verlangte und andere Hauptversionen bleiben', () => {
		const core = join(tmp, 'dedupe-core');
		const mods = join(tmp, 'dedupe-mods');
		pkg(core, 'prosemirror-model', '1.25.1');
		pkg(core, '@scope/lib', '2.0.0');
		pkg(core, 'htmlparser2', '8.0.2');
		pkg(core, 'yjs', '13.0.0');
		pkg(mods, 'prosemirror-model', '1.24.0');
		pkg(mods, '@scope/lib', '2.3.0');
		pkg(mods, 'htmlparser2', '10.0.0');
		pkg(mods, 'yjs', '13.6.33');
		pkg(mods, 'nur-modul', '1.0.0');
		expect(dedupeModulePackages(mods, core, { yjs: '13.6.33' })).toEqual([
			'@scope/lib',
			'prosemirror-model'
		]);
		expect(dedupeModulePackages(mods, core, { yjs: '13.6.33' })).toEqual([]);
	});
});

describe('coreChanged (Neubau nach Image-Wechsel)', () => {
	it('neue Version oder neuer Core-Build → Neubau', () => {
		expect(coreChanged({ core: '2.0.0', coreBuild: 'a' }, '2.0.1', 'a')).toBe(true);
		expect(coreChanged({ core: '2.0.0', coreBuild: 'a' }, '2.0.0', 'b')).toBe(true);
		expect(coreChanged({ core: '2.0.0', coreBuild: 'a' }, '2.0.0', 'a')).toBe(false);
	});
	it('alte Generation ohne Build-Kennung wird neu gebaut, unbekannter Build nicht', () => {
		expect(coreChanged({ core: '2.0.0' }, '2.0.0', 'b')).toBe(true);
		expect(coreChanged({ core: '2.0.0' }, '2.0.0', null)).toBe(false);
		expect(coreChanged(null, '2.0.0', 'b')).toBe(false);
	});
});

describe('Supervisor.rollback (zurück zur vorigen Generation)', () => {
	function supervisor(healthy: (gen: string | null) => boolean) {
		const data = join(tmp, `data-${Math.random().toString(36).slice(2)}`);
		const core = join(tmp, 'core');
		mkdirSync(join(core, 'build'), { recursive: true });
		writeFileSync(join(core, 'build', 'index.js'), '');
		writeFileSync(join(core, 'package.json'), JSON.stringify({ version: '2.0.0' }));
		for (const g of ['g1', 'g2']) {
			mkdirSync(join(data, 'gen', g, 'build'), { recursive: true });
			writeFileSync(join(data, 'gen', g, 'build', 'index.js'), '');
		}
		const sup = new Supervisor({ coreRoot: core, dataDir: data, log: () => {} });
		const started: (string | null)[] = [];
		let running: string | null = null;
		Object.assign(sup, {
			stopChild: async () => {},
			startChild: (g: string | null) => {
				running = g;
				started.push(g);
			},
			waitHealthy: async () => healthy(running)
		});
		writeFileSync(join(data, 'state.json'), JSON.stringify({ current: 'g2', previous: 'g1' }));
		const result = (planId: string) =>
			JSON.parse(readFileSync(join(data, 'results', `${planId}.json`), 'utf8')) as {
				status: string;
				generation: string | null;
			};
		return { sup, started, result };
	}

	it('tauscht aktuelle und vorige Generation und meldet „done“', async () => {
		const { sup, started, result } = supervisor(() => true);
		await sup.rollback('plan-rollback-1');
		expect(sup.state()).toMatchObject({ current: 'g1', previous: 'g2' });
		expect(started).toEqual(['g1']);
		expect(result('plan-rollback-1')).toMatchObject({ status: 'done', generation: 'g1' });
	});

	it('startet die vorige nicht, bleibt die bisherige aktiv', async () => {
		const { sup, started, result } = supervisor((g) => g !== 'g1');
		await sup.rollback('plan-rollback-2');
		expect(sup.state()).toMatchObject({ current: 'g2', previous: 'g1' });
		expect(started).toEqual(['g1', 'g2']);
		expect(result('plan-rollback-2').status).toBe('failed');
	});

	it('ohne eigene Generation (mitgelieferter Build) kein Rücksprung', async () => {
		const { sup, started, result } = supervisor(() => true);
		sup.setState({ current: null, previous: null });
		await sup.rollback('plan-rollback-3');
		expect(started).toEqual([]);
		expect(result('plan-rollback-3').status).toBe('failed');
	});
});
