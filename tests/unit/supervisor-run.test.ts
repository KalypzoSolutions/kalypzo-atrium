/**
 * Supervisor-Abläufe ohne echte App (Kindprozess und Kompilieren ersetzt): Übernahme alter Generationen (vor der
 * Bundle-Ablage) und Rückfall bei wiederholten Abstürzen mit den echten Dateien der Ablage.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'bun:test';
import { contentHashOfDir, Supervisor } from '../../scripts/supervisor/lib.mjs';

const root = mkdtempSync(join(tmpdir(), 'atrium-suprun-'));
afterAll(() => {
	if (root) rmSync(root, { recursive: true, force: true });
});

type Internals = {
	compile: (planId: string | null, opts?: Record<string, unknown>) => Promise<void>;
	startChild: () => void;
	migrateLegacy: (gen: string) => Promise<void>;
	onCrash: () => void;
	crashes: number[];
	pending: number;
	setState: (s: Record<string, unknown>) => void;
	state: () => Record<string, unknown>;
};

function supervisor(name: string) {
	const dataDir = join(root, name);
	const s = new Supervisor({
		coreRoot: join(__dirname, '..', '..'),
		dataDir,
		abi: 'abi-0123456789abcdef',
		log: () => {}
	}) as unknown as Internals;
	return { s, dataDir, bundles: join(dataDir, 'bundles') };
}

const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

describe('Übernahme einer alten Generation', () => {
	it('Module der Generation werden als Auftrag kompiliert, eingebaute nicht, danach ist gen/ weg', async () => {
		const { s, dataDir } = supervisor('legacy');
		const gen = join(dataDir, 'gen', 'g1');
		for (const id of ['fx-alt', 'fx-builtin']) {
			mkdirSync(join(gen, 'modules', id, 'node_modules', 'x'), { recursive: true });
			writeFileSync(join(gen, 'modules', id, 'module.ts'), `export default '${id}';`);
			writeFileSync(join(gen, 'modules', id, 'node_modules', 'x', 'i.js'), 'x');
		}
		writeFileSync(
			join(gen, 'atrium-modules.lock.json'),
			JSON.stringify({
				modules: {
					'fx-alt': {
						version: '1.0.0',
						sourceType: 'github',
						source: {},
						commit: 'c',
						contentHash: 'alt'
					},
					'fx-builtin': {
						version: '1.0.0',
						sourceType: 'builtin',
						source: {},
						commit: null,
						contentHash: 'b'
					}
				}
			})
		);
		s.setState({ current: 'g1', previous: null });
		let captured: {
			planId: string | null;
			opts?: Record<string, unknown>;
			request?: { modules: Record<string, { contentHash: string }> };
		} | null = null;
		s.compile = async (planId, opts) => {
			const request = json(join(dataDir, 'staging', String(planId), 'request.json'));
			captured = { planId, opts, request };
		};
		await s.migrateLegacy('g1');

		expect(captured).not.toBeNull();
		const c = captured!;
		expect(c.opts).toEqual({ partial: true });
		expect(Object.keys(c.request!.modules)).toEqual(['fx-alt']);
		// Inhaltshash neu aus den Dateien (ohne node_modules) – die Vorschau-Prüfung im Auftrag passt damit
		const staged = join(dataDir, 'staging', String(c.planId), 'modules', 'fx-alt');
		expect(c.request!.modules['fx-alt']!.contentHash).toBe(contentHashOfDir(staged));
		expect(existsSync(join(staged, 'node_modules'))).toBe(false);
		expect(existsSync(join(dataDir, 'gen'))).toBe(false);
		expect(s.state()).toMatchObject({ current: null, migratedFrom: 'g1' });
	});
});

describe('Rückfall nach wiederholten Abstürzen', () => {
	const crash = (s: Internals, n: number) => {
		s.crashes = Array.from({ length: n - 1 }, () => Date.now());
		s.onCrash();
	};

	it('mit voriger Liste: zurück auf active.prev.json, die kaputte bleibt als active.failed.json', () => {
		const { s, bundles } = supervisor('fallback-prev');
		s.startChild = () => {};
		writeFileSync(
			join(bundles, 'active.json'),
			JSON.stringify({ version: 1, modules: { neu: { dir: 'neu/b2' } } })
		);
		writeFileSync(
			join(bundles, 'active.prev.json'),
			JSON.stringify({ version: 1, modules: { alt: { dir: 'alt/b1' } } })
		);
		crash(s, 6);
		expect(Object.keys(json(join(bundles, 'active.json')).modules)).toEqual(['alt']);
		expect(Object.keys(json(join(bundles, 'active.failed.json')).modules)).toEqual(['neu']);
		expect(existsSync(join(bundles, 'active.prev.json'))).toBe(false);
	});

	it('ohne vorige Liste: Start ohne installierte Module (active.disabled.json)', () => {
		const { s, bundles } = supervisor('fallback-none');
		s.startChild = () => {};
		writeFileSync(
			join(bundles, 'active.json'),
			JSON.stringify({ version: 1, modules: { neu: { dir: 'neu/b2' } } })
		);
		crash(s, 6);
		expect(existsSync(join(bundles, 'active.json'))).toBe(false);
		expect(Object.keys(json(join(bundles, 'active.disabled.json')).modules)).toEqual(['neu']);
	});

	it('während ein Auftrag läuft: kein Rückfall, Liste bleibt', () => {
		const { s, bundles } = supervisor('fallback-busy');
		s.startChild = () => {};
		s.pending = 1;
		writeFileSync(
			join(bundles, 'active.json'),
			JSON.stringify({ version: 1, modules: { neu: { dir: 'neu/b2' } } })
		);
		crash(s, 8);
		expect(Object.keys(json(join(bundles, 'active.json')).modules)).toEqual(['neu']);
	});
});

describe('Neukompilieren nach Core-Update scheitert', () => {
	it('Fehlergrund landet in failures.json, die App startet einmal neu, Status „failed“ nennt das Modul', async () => {
		const { s, dataDir, bundles } = supervisor('recompile-fail');
		const sx = s as Internals & {
			child: unknown;
			compileOne: () => Promise<Record<string, unknown>>;
			stopChild: () => Promise<void>;
		};
		writeFileSync(
			join(bundles, 'active.json'),
			JSON.stringify({ version: 1, modules: { neu: { dir: 'neu/b1' } } })
		);
		writeFileSync(
			join(bundles, 'atrium-modules.lock.json'),
			JSON.stringify({
				modules: {
					neu: {
						version: '1.0.0',
						sourceType: 'zip',
						source: {},
						commit: null,
						contentHash: `sha256-${'a'.repeat(64)}`
					}
				}
			})
		);
		let restarts = 0;
		sx.child = {};
		sx.stopChild = async () => {};
		sx.startChild = () => {
			restarts++;
		};
		sx.compileOne = async () => ({
			ok: false,
			kind: 'missingPackage',
			message: 'Paket „x“ fehlt',
			package: 'x'
		});

		await s.compile(null, { recompile: ['neu'] });
		expect(json(join(bundles, 'failures.json')).neu).toMatchObject({
			kind: 'missingPackage',
			package: 'x'
		});
		expect(restarts).toBe(1);
		const status = json(join(dataDir, 'status.json'));
		expect(status.state).toBe('failed');
		expect(status.message).toContain('neu');
		// Stand bleibt der alte (zeigt den Grund), active.json unverändert
		expect(json(join(bundles, 'active.json')).modules.neu.dir).toBe('neu/b1');

		// Gleicher Fehler beim nächsten Start: kein weiterer Neustart nötig
		await s.compile(null, { recompile: ['neu'] });
		expect(restarts).toBe(1);
	});
});
