/**
 * Kalypzo Atrium, Phase 3: Der Core (`src/**`) kennt keine Fachmodule. Modul-IDs dürfen im Code nicht als
 * Zeichenkette vorkommen – weder allein (`'offices'`) noch als Präfix von Rechten/Bereichen (`'members.member.view'`,
 * `'offices:…'`) oder in Modulpfaden (`/modules/actions`). Fachliches Wissen gehört in Modul-Hooks
 * (`backup.adminOnlyRestore`, `principals`, `dashboard.agendaKinds` …). Kommentare zählen nicht.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduleIds, modulesDir } from '../../tools/modules-dir.js';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Bewusste Treffer ohne Modulbezug (Datei → erlaubte Literale) */
const ALLOWED: Record<string, string[]> = {
	// Honeypot-Feld „website“ der öffentlichen Formulare
	'src/lib/components/forms/FormRenderer.svelte': ['website'],
	// Deutsche Suchbegriffe für Icons („Material“ als Wort)
	'src/lib/sdk/icons/keywords-de.ts': ['material']
};

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) return files(p);
		return /\.(ts|svelte|js)$/.test(name) && !name.endsWith('.d.ts') ? [p] : [];
	});
}

/** Kommentare entfernen (Block, Zeile, HTML), Zeilen erhalten */
function stripComments(code: string): string {
	return code
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
		.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
		.replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

/** Treffer `datei:zeile → literal` */
export function findModuleIdLiterals(code: string, ids: string[], file = ''): string[] {
	if (!ids.length) return [];
	const alt = ids.map((i) => i.replace(/-/g, '\\-')).join('|');
	const literal = new RegExp(`(['"\`])(${alt})(?:\\1|[.:][a-z0-9-]*)`, 'g');
	const path = new RegExp(`/(?:modules|p|embed)/(${alt})\\b`, 'g');
	const out: string[] = [];
	stripComments(code)
		.split('\n')
		.forEach((line, i) => {
			for (const m of line.matchAll(literal)) {
				if (ALLOWED[file]?.includes(m[2]!)) continue;
				out.push(`${file}:${i + 1} → ${m[0]}`);
			}
			for (const m of line.matchAll(path)) out.push(`${file}:${i + 1} → ${m[0]}`);
		});
	return out;
}

describe('Core ohne Modul-IDs', () => {
	const ids = moduleIds(modulesDir());

	it('Erkennung greift (Gegenprobe)', () => {
		const hits = findModuleIdLiterals(
			[
				"const a = 'offices';",
				"const b = 'members.member.view';",
				'const c = `/modules/actions/x`;',
				"// 'offices' im Kommentar zählt nicht",
				"const d = 'officers';"
			].join('\n'),
			['offices', 'members', 'actions']
		);
		expect(hits).toHaveLength(3);
	});

	it('src/** nennt keine installierten Module', () => {
		const hits = files(SRC).flatMap((f) => {
			const rel = relative(ROOT, f).replace(/\\/g, '/');
			return findModuleIdLiterals(readFileSync(f, 'utf8'), ids, rel);
		});
		expect(hits).toEqual([]);
	});
});
