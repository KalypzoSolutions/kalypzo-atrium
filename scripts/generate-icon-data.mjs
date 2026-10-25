// Erzeugt `src/lib/sdk/icons/lucide-icons.json` aus dem installierten Paket `@lucide/svelte`:
// alle Icons als kompakte SVG-Knotenliste (Name → [[tag, attrs], …]). Nach einem Update von
// `@lucide/svelte` erneut ausführen: `node scripts/generate-icon-data.mjs`
// (der Unit-Test `tests/unit/icon-data.test.ts` meldet eine veraltete Datei).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pkgDir = join(process.cwd(), 'node_modules', '@lucide', 'svelte');
const iconsDir = join(pkgDir, 'dist', 'icons');
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;

const icons = {};
for (const file of readdirSync(iconsDir).sort()) {
	if (!file.endsWith('.svelte')) continue;
	const src = readFileSync(join(iconsDir, file), 'utf8');
	const match = /const iconData = (\{.*\});/.exec(src);
	if (!match) throw new Error(`Keine Icon-Daten in ${file}`);
	const data = JSON.parse(match[1]);
	icons[data.name] = data.node.map(([tag, attrs]) => {
		// `key` ist nur für Frameworks gedacht, nicht Teil der Grafik
		const { key: _key, ...rest } = attrs;
		return [tag, rest];
	});
}

const out = join(process.cwd(), 'src', 'lib', 'sdk', 'icons', 'lucide-icons.json');
writeFileSync(out, JSON.stringify({ version, icons }) + '\n');
console.log(`${Object.keys(icons).length} Icons (lucide ${version}) → ${out}`);
