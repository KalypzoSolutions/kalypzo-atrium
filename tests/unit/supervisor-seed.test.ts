/**
 * Seed für frische Deployments (Kalypzo Atrium, Phase 7): Seed-Liste prüfen, Module aus einem GitHub-Archiv lesen.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { extractSeedModules, parseSeed, readSeed } from '../../scripts/supervisor/seed.mjs';
import { filesOf, makeZip } from '../helpers/module-zip';

const ROOT = join(__dirname, '..', '..');
const FIXTURES = join(__dirname, '..', 'fixtures', 'modules');
const SHA = 'b'.repeat(40);

describe('parseSeed / readSeed', () => {
	it('liest Quellen mit festem Commit', () => {
		const seed = parseSeed({
			schema: 1,
			sources: [{ source: 'github:org/repo/modules', commit: SHA, modules: ['fx-board'] }]
		});
		expect(seed.sources[0]).toMatchObject({
			owner: 'org',
			repo: 'repo',
			path: 'modules',
			commit: SHA,
			modules: ['fx-board']
		});
	});

	it('lehnt Branches statt Commits, fremde Hosts und falsche IDs ab', () => {
		expect(() =>
			parseSeed({ schema: 1, sources: [{ source: 'github:o/r', commit: 'main' }] })
		).toThrow(/voller Commit/);
		expect(() =>
			parseSeed({ schema: 1, sources: [{ source: 'https://evil.example/x', commit: SHA }] })
		).toThrow(/github:/);
		expect(() =>
			parseSeed({ schema: 1, sources: [{ source: 'github:o/r', commit: SHA, modules: ['A_b'] }] })
		).toThrow(/Modul-IDs/);
		expect(() => parseSeed({ sources: [] })).toThrow(/schema/);
	});

	it('ATRIUM_MODULES_SEED direkt als JSON; ohne Seed → null', () => {
		const json = JSON.stringify({ schema: 1, sources: [{ source: 'github:o/r', commit: SHA }] });
		const seed = readSeed(ROOT, { ATRIUM_MODULES_SEED: json });
		expect(seed?.sources).toHaveLength(1);
		expect(seed?.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(readSeed(ROOT, { ATRIUM_MODULES_SEED: join(ROOT, 'gibt-es-nicht.json') })).toBeNull();
	});
});

describe('extractSeedModules', () => {
	const zip = makeZip(filesOf(FIXTURES), `org-repo-${SHA.slice(0, 7)}/`);

	it('Katalog: gewünschte Module mit ihren Dateien', () => {
		const mods = extractSeedModules(zip, '', ['fx-board', 'fx-people'], ROOT);
		expect(Object.keys(mods).sort()).toEqual(['fx-board', 'fx-people']);
		expect(mods['fx-board']!.dir).toBe('fx-board');
		expect(mods['fx-board']!.files.has('migrations/0002_events.sql')).toBe(true);
		expect(mods['fx-board']!.pkg.version).toBe('1.2.0');
	});

	it('ohne Auswahl alle; fehlendes Modul → Fehler', () => {
		expect(Object.keys(extractSeedModules(zip, '', null, ROOT)).sort()).toEqual([
			'fx-board',
			'fx-consumer',
			'fx-people'
		]);
		expect(() => extractSeedModules(zip, '', ['nope'], ROOT)).toThrow(/nicht enthalten/);
	});

	it('Ordner direkt auf ein Modul', () => {
		expect(Object.keys(extractSeedModules(zip, 'fx-people', null, ROOT))).toEqual(['fx-people']);
	});

	it('unsichere Pfade brechen ab', () => {
		const bad = zipSync({ 'top/../evil.ts': new TextEncoder().encode('x') });
		expect(() => extractSeedModules(bad, '', null, ROOT)).toThrow(/unsicherer Pfad/);
	});
});
