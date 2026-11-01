/**
 * ZIP-Archive für Tests der Modul-Installation: Ordner (z. B. Fixture-Module) in ein Archiv packen, optional mit
 * Oberordner wie bei GitHub (`<owner>-<repo>-<sha>/`), und gezielt manipulierte Einträge.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { zipSync, type Zippable } from 'fflate';

/** Alle Dateien unter `dir` (rekursiv), Pfade relativ zu `dir` mit `/` */
export function filesOf(dir: string, prefix = ''): Record<string, Uint8Array> {
	const out: Record<string, Uint8Array> = {};
	const walk = (d: string) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else
				out[`${prefix}${relative(dir, p).replace(/\\/g, '/')}`] = new Uint8Array(readFileSync(p));
		}
	};
	walk(dir);
	return out;
}

/** Archiv aus Pfad → Inhalt (Text oder Bytes); `top` = gemeinsamer Oberordner */
export function makeZip(
	entries: Record<string, string | Uint8Array>,
	top = 'org-repo-0123456/'
): Uint8Array {
	const z: Zippable = {};
	for (const [k, v] of Object.entries(entries)) {
		z[`${top}${k}`] = typeof v === 'string' ? new TextEncoder().encode(v) : v;
	}
	return zipSync(z);
}

/** Archiv mit einem Eintrag, der als Symlink markiert ist (Unix-Modus 0o120777) */
export function makeSymlinkZip(): Uint8Array {
	return zipSync({
		'repo/module.ts': new TextEncoder().encode('export default {};'),
		'repo/link.ts': [
			new TextEncoder().encode('/etc/passwd'),
			{ os: 3, attrs: (0o120777 << 16) >>> 0 }
		]
	});
}
