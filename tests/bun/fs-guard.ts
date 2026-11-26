/**
 * Sicherheitsnetz für `bun test`: rekursives Löschen gefährlicher Ziele wirft sofort.
 *
 * Anlass (2026-11-26): Unter Bun löscht `rmSync('', { recursive: true, force: true })` den **Inhalt des
 * Arbeitsverzeichnisses** (Node: No-op). Ein `afterAll`, dessen `beforeAll` vor dem Anlegen des Temp-Ordners
 * scheiterte, hat so den Projektordner geleert. Geblockt werden leere Pfade, das Arbeitsverzeichnis, die
 * Projektwurzel, deren Elternordner, Laufwerks-/Dateisystemwurzeln und das Home-Verzeichnis.
 *
 * Umgesetzt per `mock.module` (Umbiegen der Funktionen erreicht benannte ESM-Importe nicht).
 */
import { mock } from 'bun:test';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { homedir } from 'node:os';
import { parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export function dangerous(target: unknown): string | null {
	if (target instanceof URL) target = fileURLToPath(target);
	if (Buffer.isBuffer(target)) target = target.toString();
	if (typeof target !== 'string') return null;
	if (target.trim() === '') return 'leerer Pfad';
	const abs = resolve(target);
	const same = (a: string, b: string) => relative(a, b) === '';
	const isAncestorOrSelf = (dir: string) => {
		const rel = relative(abs, dir);
		return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !parse(rel).root);
	};
	if (same(abs, parse(abs).root)) return 'Dateisystemwurzel';
	if (same(abs, homedir())) return 'Home-Verzeichnis';
	if (isAncestorOrSelf(process.cwd())) return 'Arbeitsverzeichnis oder dessen Elternordner';
	if (isAncestorOrSelf(CORE_ROOT)) return 'Projektwurzel oder deren Elternordner';
	return null;
}

function check(op: string, target: unknown): void {
	const why = dangerous(target);
	if (why)
		throw new Error(`fs-guard: ${op}(${JSON.stringify(String(target))}) verweigert – ${why}`);
}

// Originale festhalten, BEVOR gemockt wird: `mock.module` ersetzt den Namespace in place, ein späteres
// `fs.rmSync` wäre sonst schon der Wrapper (Endlosschleife)
const real = {
	fs: { ...fs },
	rmSync: fs.rmSync,
	rmdirSync: fs.rmdirSync,
	rm: fs.rm as (...a: unknown[]) => void,
	rmdir: fs.rmdir as (...a: unknown[]) => void,
	fsp: { ...fsp },
	rmAsync: fsp.rm,
	rmdirAsync: fsp.rmdir
};

const rmSync: typeof fs.rmSync = (p, o) => (check('rmSync', p), real.rmSync(p, o));
const rmdirSync: typeof fs.rmdirSync = (p, o?: fs.RmDirOptions) => (
	check('rmdirSync', p), (real.rmdirSync as (...a: unknown[]) => void)(p, o)
);
const rm = ((p: fs.PathLike, ...rest: unknown[]) => {
	check('rm', p);
	return real.rm(p, ...rest);
}) as typeof fs.rm;
const rmdir = ((p: fs.PathLike, ...rest: unknown[]) => {
	check('rmdir', p);
	return real.rmdir(p, ...rest);
}) as typeof fs.rmdir;
const rmAsync: typeof fsp.rm = async (p, o) => (check('rm', p), real.rmAsync(p, o));
const rmdirAsync: typeof fsp.rmdir = async (p, o?: fs.RmDirOptions) => (
	check('rmdir', p), (real.rmdirAsync as (...a: unknown[]) => Promise<void>)(p, o)
);

const promises = { ...real.fsp, rm: rmAsync, rmdir: rmdirAsync };
const fsGuarded = { ...real.fs, rmSync, rmdirSync, rm, rmdir, promises };
mock.module('node:fs', () => ({ ...fsGuarded, default: fsGuarded }));
mock.module('fs', () => ({ ...fsGuarded, default: fsGuarded }));
mock.module('node:fs/promises', () => ({ ...promises, default: promises }));
mock.module('fs/promises', () => ({ ...promises, default: promises }));
