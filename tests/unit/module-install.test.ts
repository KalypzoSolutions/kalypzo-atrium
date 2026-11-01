/**
 * Modul-Installation (Kalypzo Atrium, Phase 5) – reine Bausteine: sicheres Entpacken, Eingabe, Auffinden der Module,
 * Auflösen der Abhängigkeiten (ohne installierte Module).
 */
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { contentHash, readModuleArchive } from '$lib/server/core/modules/install/archive';
import { discoverModules } from '$lib/server/core/modules/install/discover';
import { resolvePlan, type Candidate } from '$lib/server/core/modules/install/resolve';
import { parseInstallInput } from '$lib/server/core/modules/install/service';
import { makeSymlinkZip, makeZip } from '../helpers/module-zip';

const enc = (s: string) => new TextEncoder().encode(s);
const pkg = (id: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		schema: 1,
		id,
		name: `Modul ${id}`,
		version: '1.0.0',
		core: '>=2.0.0-0 <3.0.0',
		...extra
	});

function expectArchiveError(zip: Uint8Array, pattern: RegExp) {
	try {
		readModuleArchive(zip);
	} catch (e) {
		const err = e as { code: string; details?: { message: string }[]; message: string };
		const text = err.details?.map((d) => d.message).join(' ') ?? err.message;
		expect(text).toMatch(pattern);
		return;
	}
	throw new Error('Archiv wurde nicht abgelehnt');
}

describe('readModuleArchive', () => {
	it('entfernt den gemeinsamen Oberordner und liest Inhalte', () => {
		const files = readModuleArchive(makeZip({ 'a/module.ts': 'x', 'README.md': '# Hallo' }));
		expect([...files.keys()].sort()).toEqual(['README.md', 'a/module.ts']);
		expect(new TextDecoder().decode(files.get('README.md'))).toBe('# Hallo');
	});

	it('ohne gemeinsamen Oberordner bleiben die Pfade', () => {
		const files = readModuleArchive(makeZip({ 'x/a.ts': 'a', 'y/b.ts': 'b' }, ''));
		expect([...files.keys()].sort()).toEqual(['x/a.ts', 'y/b.ts']);
	});

	it('lehnt Symlinks ab', () => {
		expectArchiveError(makeSymlinkZip(), /Symlinks/);
	});

	it('lehnt Pfad-Ausbrüche, absolute Pfade und Backslashes ab', () => {
		expectArchiveError(zipSync({ '../evil.ts': enc('x') }), /Ungültiger Pfad/);
		expectArchiveError(zipSync({ 'a/../../evil.ts': enc('x') }), /Ungültiger Pfad/);
		expectArchiveError(zipSync({ '/etc/evil.ts': enc('x') }), /Absoluter Pfad/);
		expectArchiveError(zipSync({ 'a\\evil.ts': enc('x') }), /Ungültiger Pfad/);
	});

	it('lehnt versteckte Dateien, node_modules und unbekannte Endungen ab', () => {
		expectArchiveError(makeZip({ '.env': 'SECRET=1' }), /Versteckte/);
		expectArchiveError(makeZip({ 'node_modules/x/index.js': 'x' }), /node_modules/);
		expectArchiveError(makeZip({ 'tool.exe': 'MZ' }), /Dateityp/);
		expectArchiveError(makeZip({ 'run.sh': 'rm -rf /' }), /Dateityp/);
	});

	it('lehnt Kollisionen nach Groß/Klein ab', () => {
		expectArchiveError(makeZip({ 'a/Module.ts': '1', 'a/module.ts': '2' }), /Doppelter Pfad/);
	});

	it('lehnt ZIP-Bomben und zu große Dateien ab', () => {
		const zeros = new Uint8Array(5 * 1024 * 1024);
		expectArchiveError(makeZip({ 'big.txt': zeros }), /stark gepackt/);
		const random = new Uint8Array(11 * 1024 * 1024).map((_, i) => (i * 2654435761) >>> 24);
		expectArchiveError(zipSync({ 'big.txt': [random, { level: 0 }] }), /zu groß/);
	});

	it('lehnt Nicht-ZIP-Dateien ab', () => {
		expectArchiveError(enc('kein zip'), /kein gültiges ZIP/);
	});

	it('Inhaltshash hängt nur von Pfaden und Inhalten ab', () => {
		const a = readModuleArchive(makeZip({ 'x/a.ts': 'a', 'x/b.ts': 'b' }));
		const b = readModuleArchive(makeZip({ 'x/b.ts': 'b', 'x/a.ts': 'a' }, 'other-top-1/'));
		expect(contentHash(a)).toBe(contentHash(b));
		const c = readModuleArchive(makeZip({ 'x/a.ts': 'a', 'x/b.ts': 'B' }));
		expect(contentHash(c)).not.toBe(contentHash(a));
	});
});

describe('parseInstallInput', () => {
	it('liest Kurzformen und GitHub-Links; Ref mit Pfad bleibt zur Auflösung offen', () => {
		expect(parseInstallInput('org/repo')).toMatchObject({
			source: { owner: 'org', repo: 'repo', ref: null, path: '' },
			pathAfterRef: []
		});
		expect(
			parseInstallInput('https://github.com/org/repo/tree/feature/x/modules/kasse')
		).toMatchObject({
			source: { owner: 'org', repo: 'repo', ref: 'feature', path: '' },
			pathAfterRef: ['x', 'modules', 'kasse']
		});
		expect(parseInstallInput('github:org/repo/modules/kasse#v2')).toMatchObject({
			source: { path: 'modules/kasse', ref: 'v2' }
		});
	});

	it('lehnt andere Hosts ab', () => {
		expect(() => parseInstallInput('https://gitlab.com/org/repo')).toThrow();
		expect(() => parseInstallInput('http://github.com/org/repo')).toThrow();
	});
});

describe('discoverModules', () => {
	const mod = (id: string) => ({
		[`modules/${id}/atrium-module.json`]: pkg(id),
		[`modules/${id}/module.ts`]: 'export default {};',
		[`modules/${id}/migrations/0001_init.sql`]: 'CREATE TABLE x (id text);'
	});

	it('über den Katalog', () => {
		const files = readModuleArchive(
			makeZip({
				'atrium-modules.json': JSON.stringify({
					schema: 1,
					name: 'Testkatalog',
					modules: [
						{ id: 'aa', path: 'modules/aa' },
						{ id: 'bb', path: 'modules/bb' }
					]
				}),
				...mod('aa'),
				...mod('bb')
			})
		);
		const repo = discoverModules(files);
		expect(repo.catalogName).toBe('Testkatalog');
		expect(repo.modules.map((m) => m.id)).toEqual(['aa', 'bb']);
		expect(repo.modules[0]!.migrations).toEqual([
			{ name: '0001_init', sql: 'CREATE TABLE x (id text);' }
		]);
	});

	it('ohne Katalog: modules/*, ein Ordner oder ein Ein-Modul-Repository', () => {
		const files = readModuleArchive(makeZip({ ...mod('aa'), ...mod('bb') }));
		expect(discoverModules(files).modules.map((m) => m.id)).toEqual(['aa', 'bb']);
		expect(discoverModules(files, 'modules/bb').modules.map((m) => m.id)).toEqual(['bb']);
		const single = readModuleArchive(
			makeZip({ 'atrium-module.json': pkg('solo'), 'module.ts': 'x' })
		);
		expect(discoverModules(single).modules.map((m) => m.id)).toEqual(['solo']);
	});

	it('meldet Ordner mit falscher ID oder ohne module.ts als Problem', () => {
		const files = readModuleArchive(
			makeZip({
				'modules/aa/atrium-module.json': pkg('zz'),
				'modules/aa/module.ts': 'x',
				'modules/cc/atrium-module.json': pkg('cc')
			})
		);
		const repo = discoverModules(files);
		expect(repo.modules).toEqual([]);
		expect(repo.problems.map((p) => p.reason).join(' ')).toMatch(/passt nicht zur Modul-ID/);
		expect(repo.problems.map((p) => p.reason).join(' ')).toMatch(/module\.ts fehlt/);
	});

	it('ohne Module → 422', () => {
		const files = readModuleArchive(makeZip({ 'README.md': 'x' }));
		expect(() => discoverModules(files)).toThrow(
			expect.objectContaining({
				code: 'validation_failed',
				details: [expect.objectContaining({ message: expect.stringMatching(/Keine Module/) })]
			})
		);
	});
});

describe('resolvePlan', () => {
	const cand = (id: string, extra: Record<string, unknown> = {}): Candidate => {
		const files = readModuleArchive(
			makeZip({ 'atrium-module.json': pkg(id, extra), 'module.ts': 'x' })
		);
		return {
			mod: discoverModules(files).modules[0]!,
			origin: { type: 'upload', fileName: 't.zip', zipSha256: 'x', path: '' }
		};
	};
	const noSource = async () => null;

	it('ergänzt harte Abhängigkeiten aus derselben Quelle, Abhängigkeiten zuerst', async () => {
		const repo = [
			cand('app', {
				dependencies: { base: { version: '^1.0.0' } },
				optionalDependencies: { extra: { version: '^1.0.0' } }
			}),
			cand('base'),
			cand('extra')
		];
		const plan = await resolvePlan(['app'], repo, noSource);
		expect(plan.blockers).toEqual([]);
		expect(plan.entries.map((e) => [e.mod.id, e.reason, e.requiredBy])).toEqual([
			['base', 'dependency', ['app']],
			['app', 'selected', []]
		]);
		expect(plan.recommended).toEqual([{ id: 'extra', requiredBy: 'app', available: true }]);
	});

	it('lädt fehlende Abhängigkeiten über den source-Link', async () => {
		const repo = [
			cand('app', {
				dependencies: { base: { version: '^1.0.0', source: 'github:org/base#main' } }
			})
		];
		const loaded: string[] = [];
		const plan = await resolvePlan(['app'], repo, async (source, id) => {
			loaded.push(`${source}|${id}`);
			return cand('base');
		});
		expect(loaded).toEqual(['github:org/base#main|base']);
		expect(plan.entries.map((e) => e.mod.id)).toEqual(['base', 'app']);
	});

	it('sperrt fehlende Abhängigkeit, falsche Version und Zyklen', async () => {
		const missing = await resolvePlan(
			['app'],
			[cand('app', { dependencies: { base: { version: '^1.0.0' } } })],
			noSource
		);
		expect(missing.blockers.join(' ')).toMatch(/braucht base \^1\.0\.0 – nicht installiert/);

		const wrong = await resolvePlan(
			['app'],
			[cand('app', { dependencies: { base: { version: '^2.0.0' } } }), cand('base')],
			noSource
		);
		expect(wrong.blockers.join(' ')).toMatch(/liefert 1\.0\.0/);

		const cycle = await resolvePlan(
			['aa'],
			[
				cand('aa', { dependencies: { bb: { version: '^1.0.0' } } }),
				cand('bb', { dependencies: { aa: { version: '^1.0.0' } } })
			],
			noSource
		);
		expect(cycle.blockers.join(' ')).toMatch(/Zyklische Abhängigkeit/);
	});

	it('unbekannte Auswahl wird gemeldet', async () => {
		const plan = await resolvePlan(['nope'], [cand('app')], noSource);
		expect(plan.blockers).toEqual(['Modul „nope“ gibt es in dieser Quelle nicht']);
	});
});
