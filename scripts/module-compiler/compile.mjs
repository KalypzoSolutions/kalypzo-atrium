#!/usr/bin/env bun
// @ts-check
/**
 * Ein Fachmodul einzeln kompilieren (siehe `lib.mjs`).
 *
 *   bun scripts/module-compiler/compile.mjs <modulordner> <ausgabeordner> [--no-install]
 *
 * Fortschritt auf stderr; Ergebnis als **eine** Zeile auf stdout:
 *   ATRIUM_COMPILE {"ok":true,"meta":{…}}
 *   ATRIUM_COMPILE {"ok":false,"error":{"kind":"missingPackage","message":"…","package":"…"}}
 * Exit-Code 0 bei Erfolg, sonst 1.
 */
import { COMPILE_PREFIX, CompileError, compileModule } from './lib.mjs';

const args = process.argv.slice(2);
const [moduleDir, outDir] = args.filter((a) => !a.startsWith('--'));
const emit = (/** @type {unknown} */ result, /** @type {number} */ code) =>
	process.stdout.write(`${COMPILE_PREFIX}${JSON.stringify(result)}\n`, () => process.exit(code));

if (!moduleDir || !outDir) {
	process.stderr.write('Aufruf: compile.mjs <modulordner> <ausgabeordner> [--no-install]\n');
	process.exit(2);
}

try {
	const meta = await compileModule({
		moduleDir,
		outDir,
		installPackages: !args.includes('--no-install'),
		log: (line) => process.stderr.write(`${line}\n`)
	});
	emit({ ok: true, meta }, 0);
} catch (e) {
	const message = e instanceof Error ? e.message : String(e);
	emit(
		{
			ok: false,
			error: {
				kind: e instanceof CompileError ? e.kind : 'build',
				message,
				package: e instanceof CompileError ? e.packageName : null
			}
		},
		1
	);
}
