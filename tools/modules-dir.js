// @ts-check
/**
 * Ort der installierten Fachmodule – gemeinsam für Vite, SvelteKit (Alias `$modules`), ESLint und Tests.
 *
 * `ATRIUM_MODULES_DIR` (absolut oder relativ zum Projekt) überschreibt den Standard `<root>/modules`.
 * Core-Tests zeigen damit z. B. auf `tests/fixtures/modules`, das Module-Repo auf seinen eigenen Ordner.
 */
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Projektwurzel des Core (Ordner über `tools/`). */
export const CORE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Absoluter Pfad des Modulverzeichnisses (mit `/` als Trenner, auch unter Windows). */
export function modulesDir() {
	const raw = process.env.ATRIUM_MODULES_DIR?.trim();
	const dir = raw ? (isAbsolute(raw) ? raw : resolve(CORE_ROOT, raw)) : join(CORE_ROOT, 'modules');
	return dir.replace(/\\/g, '/');
}

/** Modul-IDs im Verzeichnis: Unterordner mit `module.ts`, sortiert. */
export function moduleIds(dir = modulesDir()) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'module.ts')))
		.map((e) => e.name)
		.sort();
}
