/**
 * Icon-Bibliothek (`$lib/sdk/icons`): Daten passen zum installierten `@lucide/svelte` (sonst
 * `node scripts/generate-icon-data.mjs` ausführen), deutsche Begriffe/Vorschläge zeigen auf echte Icons, Suche.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	ICON_KEYWORDS_DE,
	ICON_SUGGESTIONS,
	foldIconText,
	iconLabel,
	loadIconSet,
	searchIcons
} from '$lib/sdk/icons';

const pkgDir = join(process.cwd(), 'node_modules', '@lucide', 'svelte');

describe('Icon-Daten', () => {
	it('entsprechen der installierten Lucide-Version (sonst Generator ausführen)', async () => {
		const set = await loadIconSet();
		const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
		const count = readdirSync(join(pkgDir, 'dist', 'icons')).filter((f) =>
			f.endsWith('.svelte')
		).length;
		expect(set.version).toBe(version);
		expect(set.names.length).toBe(count);
		expect(set.names.length).toBeGreaterThan(1000);
	});

	it('jedes Icon hat SVG-Elemente mit bekannten Tags', async () => {
		const set = await loadIconSet();
		const tags = new Set<string>();
		for (const name of set.names) {
			const node = set.get(name)!;
			expect(node.length).toBeGreaterThan(0);
			for (const [tag] of node) tags.add(tag);
		}
		for (const t of tags) {
			expect(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']).toContain(t);
		}
	});

	it('deutsche Begriffe und Vorschläge verweisen nur auf vorhandene Icons', async () => {
		const set = await loadIconSet();
		const missing = [
			...Object.keys(ICON_KEYWORDS_DE),
			...ICON_SUGGESTIONS.flatMap((g) => g.icons)
		].filter((n) => !set.has(n));
		expect(missing).toEqual([]);
	});
});

describe('searchIcons', () => {
	it('findet über deutsche Begriffe (Umlaute gefaltet) und englische Namen', async () => {
		const set = await loadIconSet();
		expect(searchIcons(set, 'Zelt')[0]).toBe('tent');
		expect(searchIcons(set, 'kasse')).toContain('wallet');
		expect(searchIcons(set, 'gepaeck')).toContain('backpack');
		expect(searchIcons(set, 'Gepäck')).toContain('backpack');
		expect(searchIcons(set, 'tent')[0]).toBe('tent');
		expect(searchIcons(set, 'tree pine')).toContain('tree-pine');
	});

	it('alle Wörter müssen passen, Grenze und leere Suche', async () => {
		const set = await loadIconSet();
		expect(searchIcons(set, 'zelt xyzunbekannt')).toEqual([]);
		expect(searchIcons(set, 'file', 5)).toHaveLength(5);
		expect(searchIcons(set, '  ', 3)).toEqual(set.names.slice(0, 3));
	});

	it('foldIconText und iconLabel', () => {
		expect(foldIconText('Größe-Übung')).toBe('groesse uebung');
		expect(iconLabel('tent')).toBe('Zelt');
		expect(iconLabel('a-arrow-down')).toBe('a arrow down');
	});
});
