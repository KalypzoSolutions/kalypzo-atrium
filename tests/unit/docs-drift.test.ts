import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_PERMISSIONS } from '$lib/server/core/permissions/catalog';

/**
 * Doku-Drift (#76, 10-06/10-07): Katalog und Moduldateien müssen in der Doku stehen, damit Agents
 * und Entwickler*innen nicht auf veralteter Grundlage arbeiten.
 */
const root = process.cwd();
const read = (...p: string[]) => readFileSync(join(root, ...p), 'utf8');

describe('Doku-Abgleich', () => {
	it('docs/permissions.md nennt jedes Core-Recht', () => {
		const text = read('docs', 'permissions.md');
		const missing = Object.keys(CORE_PERMISSIONS).filter((k) => !text.includes(`\`${k}\``));
		expect(missing).toEqual([]);
	});

	it('docs/module-development.md nennt jedes optionale Feld von ModuleDefinition', () => {
		const types = read('src', 'lib', 'server', 'core', 'modules', 'types.ts');
		const body = types.slice(types.indexOf('export interface ModuleDefinition {'));
		const block = body.slice(0, body.indexOf('\n}'));
		const fields = [...block.matchAll(/^\t([a-zA-Z]+)\?:/gm)].map((m) => m[1]!);
		expect(fields.length).toBeGreaterThan(10);
		const text = read('docs', 'module-development.md');
		const missing = fields.filter((f) => !text.includes(f));
		expect(missing).toEqual([]);
	});
});
