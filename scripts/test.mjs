// Startet `bun test` für Core und Module (Ersatz für `vitest run`).
//   bun scripts/test.mjs [--coverage] [weitere bun-test-Argumente] [Pfade …]
// - vorher `svelte-kit sync`: Bun löst `$lib`/`$testing`/`$modules` über `.svelte-kit/tsconfig.json` auf, und `$modules`
//   zeigt dort auf das gerade gewählte `ATRIUM_MODULES_DIR`
// - ohne Pfade: `tests/`, `src/` und das Modulverzeichnis (auch außerhalb des Projekts, z. B. im Module-Repo)
// - Dateien laufen parallel in eigenen Prozessen (`--parallel`, je Datei frischer Kontext wie bei Vitest)
// - mit `--coverage`: Gesamtschwellen aus `coverage/lcov.info` (Buns `coverageThreshold` gilt je Datei)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_ROOT, modulesDir } from '../tools/modules-dir.js';

/** Gesamtschwellen, gewichtet aus lcov (Messung 2026-11-26: Zeilen 75,4 %, Funktionen 77,2 %) – schrittweise anheben */
const THRESHOLDS = { lines: 73, functions: 75 };

const args = process.argv.slice(2);
const sync = spawnSync(
	process.execPath,
	[join(CORE_ROOT, 'node_modules', '@sveltejs', 'kit', 'svelte-kit.js'), 'sync'],
	{ cwd: CORE_ROOT, stdio: 'inherit' }
);
if (sync.status !== 0) process.exit(sync.status ?? 1);

const hasPath = args.some((a) => !a.startsWith('-'));
const paths = hasPath ? [] : ['./tests', './src'];
const mods = modulesDir();
if (!hasPath && existsSync(mods) && !mods.startsWith(`${CORE_ROOT.replace(/\\/g, '/')}/tests/`)) {
	paths.push(mods);
}
// --timeout: `[test] timeout` aus bunfig.toml greift nicht zuverlässig (Bun bleibt bei 5 s)
const result = spawnSync(
	process.execPath,
	['test', '--parallel', '--timeout=30000', ...args, ...paths],
	{ cwd: CORE_ROOT, stdio: 'inherit' }
);
if (result.status !== 0) process.exit(result.status ?? 1);

if (args.includes('--coverage')) {
	const lcov = join(CORE_ROOT, 'coverage', 'lcov.info');
	if (!existsSync(lcov)) {
		console.error('Coverage: coverage/lcov.info fehlt');
		process.exit(1);
	}
	const sum = { LF: 0, LH: 0, FNF: 0, FNH: 0 };
	for (const line of readFileSync(lcov, 'utf8').split(/\r?\n/)) {
		const m = /^(LF|LH|FNF|FNH):(\d+)$/.exec(line);
		if (m) sum[m[1]] += Number(m[2]);
	}
	const pct = (hit, found) => (found ? (hit / found) * 100 : 100);
	const actual = { lines: pct(sum.LH, sum.LF), functions: pct(sum.FNH, sum.FNF) };
	let failed = false;
	for (const [key, min] of Object.entries(THRESHOLDS)) {
		const ok = actual[key] >= min;
		if (!ok) failed = true;
		console.log(
			`Coverage ${key}: ${actual[key].toFixed(2)} % (Schwelle ${min} %) ${ok ? 'ok' : 'ZU NIEDRIG'}`
		);
	}
	if (failed) process.exit(1);
}
