/**
 * Gemeinsames Utilities-CSS für vorkompilierte Modul-Bundles: Tailwind-Klassen des Core **und** aller geladenen Bundles
 * in **einer** Tailwind-Reihenfolge (Basis-Klassen vor Varianten, wie im CSS des Core). Als letztes Stylesheet der
 * Seite eingebunden (`hooks.server.ts`), damit es Varianten aus Modulen (z. B. `sm:left-3`) gegen Basis-Klassen des
 * Core (`left-1/2`) richtig auflöst. Getrennte Teil-Stylesheets je Modul können das nicht (gemessen, siehe
 * `scripts/module-compiler/lib.mjs` → `tailwindCandidates`).
 *
 * Gebaut einmal je Prozess (die Bundles stehen ab dem Start fest), braucht `@tailwindcss/node`/`@tailwindcss/oxide`
 * und `src/app.css` des Core (im Image vorhanden). Ohne sie: kein gemeinsames CSS (Warnung im Protokoll).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Wurzel des Core zur Laufzeit: das Arbeitsverzeichnis (Supervisor, Image `WORKDIR /app`, E2E-Server starten die App
 * dort; wie `drizzle/` in `database/migrate.ts`). `tools/modules-dir.js` `CORE_ROOT` taugt hier nicht – beim Bündeln
 * zeigt es auf `build/server`.
 */
const coreRoot = () => resolve(process.env.ATRIUM_CORE_ROOT?.trim() || process.cwd());

export interface UtilitiesCss {
	hash: string;
	css: string;
}

const TAILWIND_NODE = ['@tailwindcss', 'node'].join('/');
const TAILWIND_OXIDE = ['@tailwindcss', 'oxide'].join('/');

let built: Promise<UtilitiesCss | null> | undefined;
let lastKey = '';

const norm = (p: string) => p.replace(/\\/g, '/');

/**
 * Utilities-CSS für Core + Kandidaten der Bundles (`meta.client.tailwind`). `null`: keine Bundles oder Tailwind fehlt.
 * Gleiche Kandidaten → gleiches Ergebnis (zwischengespeichert).
 */
export function utilitiesCss(moduleCandidates: readonly string[][]): Promise<UtilitiesCss | null> {
	const extra = [...new Set(moduleCandidates.flat())].sort();
	if (!extra.length) return Promise.resolve(null);
	const key = createHash('sha256').update(extra.join('\n')).digest('hex');
	if (built && key === lastKey) return built;
	lastKey = key;
	built = build(extra).catch((e: unknown) => {
		console.error(
			'[modules] Gemeinsames Utilities-CSS der Module nicht erzeugt (Klassen aus Modulen fehlen ggf.):',
			e instanceof Error ? e.message : e
		);
		return null;
	});
	return built;
}

async function build(extra: string[]): Promise<UtilitiesCss | null> {
	const appCss = join(coreRoot(), 'src', 'app.css');
	if (!existsSync(appCss)) throw new Error(`${appCss} fehlt`);
	// Zur Laufzeit aus node_modules laden, nicht mitbündeln (Dev-Abhängigkeiten, `oxide` ist ein natives Modul):
	// Spezifizierer als Variable, damit weder Vite noch adapter-node den Import auflösen
	const load = (name: string) => import(/* @vite-ignore */ name);
	const { compile } = (await load(TAILWIND_NODE)) as {
		compile: (
			css: string,
			opts: { base: string; onDependency: (path: string) => void }
		) => Promise<{ build: (candidates: string[]) => string }>;
	};
	const { Scanner } = (await load(TAILWIND_OXIDE)) as {
		Scanner: new (opts: { sources: { base: string; pattern: string; negated: boolean }[] }) => {
			scan: () => string[];
		};
	};
	const coreCandidates = new Scanner({
		sources: [{ base: norm(join(coreRoot(), 'src')), pattern: '**/*', negated: false }]
	}).scan();
	const input = [
		`@reference ${JSON.stringify(norm(appCss))};`,
		// gleiche Ebenen-Reihenfolge wie im CSS des Core (falls dieses Stylesheet zuerst Ebenen nennt)
		'@layer properties, theme, base, components, utilities;',
		'@layer utilities {',
		'@tailwind utilities;',
		'}'
	].join('\n');
	const compiler = await compile(input, { base: norm(coreRoot()), onDependency: () => {} });
	const css = compiler.build([...new Set([...coreCandidates, ...extra])]);
	return { hash: createHash('sha256').update(css).digest('hex').slice(0, 16), css };
}

/** Nur für Tests */
export function resetUtilitiesCssForTests(): void {
	built = undefined;
	lastKey = '';
}
