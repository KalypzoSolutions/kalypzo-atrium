// @ts-check
/**
 * Host-ABI: was ein separat kompiliertes Modul-Bundle vom Core **geteilt** bekommt, statt es selbst mitzubringen.
 * Gemeinsam für das Vite-Plugin (Registry `virtual:atrium-host/{client,server}`) und den Modul-Compiler.
 *
 * - Pakete, die genau einmal existieren dürfen (Svelte-Laufzeit, SvelteKit-`$app/*`, Toasts, zod, drizzle).
 * - Die für Module freigegebenen `$lib`-Bereiche (siehe ESLint `moduleRules`, `docs/module-development.md`):
 *   je Datei ein Eintrag, Schlüssel `lib:<Pfad relativ zu src/lib>` – unabhängig davon, ob ein Modul
 *   `$lib/components/ui/button`, `…/button/index` oder `…/button/index.ts` schreibt.
 *
 * Ein Modul-Bundle löst diese Importe zur Laufzeit über `globalThis.__atriumHost` auf (gleiche Instanz wie der Core).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CORE_ROOT } from './modules-dir.js';

export const LIB_DIR = join(CORE_ROOT, 'src', 'lib').replace(/\\/g, '/');

/** @typedef {'client' | 'server'} HostSide */

/**
 * Geteilte Pakete je Seite. `svelte/*` mit Laufzeitcode (ohne Compiler und reine Typ-Exporte wie `svelte/action`,
 * `svelte/elements`); `drizzle-orm` nur auf dem Server.
 * Im Browser **nicht** geteilt: `zod` (voller Namespace = +278 KB je Seite gemessen; Bundles bringen eine Kopie mit und
 * binden `$lib/zod-locale` ein, die Texte kommen aus dem geteilten i18n-Katalog). `svelte-sonner` nur als `toast`
 * (`CLIENT_PACKAGE_TARGETS`).
 * @type {Record<HostSide, readonly string[]>}
 */
export const HOST_PACKAGES = {
	client: [
		'svelte',
		'svelte/animate',
		'svelte/attachments',
		'svelte/easing',
		'svelte/events',
		'svelte/internal/client',
		'svelte/internal/disclose-version',
		'svelte/internal/flags/async',
		'svelte/internal/flags/legacy',
		'svelte/internal/flags/tracing',
		'svelte/legacy',
		'svelte/motion',
		'svelte/reactivity',
		'svelte/reactivity/window',
		'svelte/store',
		'svelte/transition',
		'$app/environment',
		'$app/forms',
		'$app/navigation',
		'$app/paths',
		'$app/state',
		'svelte-sonner'
	],
	server: [
		'svelte',
		'svelte/animate',
		'svelte/attachments',
		'svelte/easing',
		'svelte/events',
		'svelte/internal/server',
		'svelte/internal/disclose-version',
		'svelte/internal/flags/async',
		'svelte/internal/flags/legacy',
		'svelte/internal/flags/tracing',
		'svelte/legacy',
		'svelte/motion',
		'svelte/reactivity',
		'svelte/reactivity/window',
		'svelte/store',
		'svelte/transition',
		'$app/environment',
		'$app/forms',
		'$app/navigation',
		'$app/paths',
		'$app/state',
		'svelte-sonner',
		'zod',
		'drizzle-orm'
	]
};

/** Im Browser: Paket → Weiterleitung unter `src/lib` (nur die Exporte, die Module brauchen) */
export const CLIENT_PACKAGE_TARGETS = { 'svelte-sonner': 'host/sonner.ts' };

/** Für Module freigegebene Bereiche unter `src/lib` (Ordner) bzw. Einzeldateien */
export const HOST_LIB_DIRS = [
	'sdk',
	'forms',
	'pdf-lists',
	'components/ui',
	'components/layout',
	'components/forms'
];
export const HOST_LIB_FILES = ['utils.ts'];

/**
 * Im **Browser** geteilt werden nur `$lib`-Dateien mit Zustand auf Modulebene (Katalog, Stores, Caches, Kontext-
 * Schlüssel). Alles andere (UI-Bausteine, zustandslose Helfer) bringt ein Modul-Bundle als eigene Kopie mit – mit
 * derselben Svelte-Version kompiliert. Würde der Core alles teilen, müsste er alle Exporte jeder Datei behalten
 * (kein Tree-Shaking mehr): gemessen +50 % JS und 9× so viele Dateien je Seite.
 * Auf dem Server spielt die Bundle-Größe keine Rolle; dort ist alles aus `HOST_LIB_DIRS` geteilt.
 */
export const CLIENT_SHARED_LIB = [
	'i18n/index.ts',
	'theme.svelte.ts',
	'forms/registry.ts',
	'sdk/client/nav-badges.svelte.ts',
	'sdk/client/assist.ts',
	'sdk/icons/index.ts',
	'components/ui/field/context.ts',
	'components/ui/icon-picker/icons-state.svelte.ts',
	'components/layout/sheet-history.ts',
	'components/layout/viewport.svelte.ts'
];

const SOURCE = /\.(ts|js|svelte)$/;
const SKIP = /\.(d|test|spec)\.ts$/;

/**
 * Geteilte `$lib`-Dateien einer Seite, relativ zu `src/lib`, sortiert: Server alle freigegebenen Bereiche,
 * Browser nur `CLIENT_SHARED_LIB`. Gemessen (2026-11-26): zusätzlich `components/ui` zu teilen spart je Modul ~270 KB,
 * macht aber **jede** Core-Seite schwerer (72 statt 17 Dateien, +110 KB) – deshalb nicht.
 * @param {HostSide} side
 * @param {string} [libDir]
 * @returns {string[]}
 */
export function hostLibFiles(side, libDir = LIB_DIR) {
	if (side === 'client') return CLIENT_SHARED_LIB.filter((f) => existsSync(join(libDir, f))).sort();
	return allowedLibFiles(libDir);
}

/**
 * Alle für Module freigegebenen `$lib`-Dateien (`HOST_LIB_DIRS` + `HOST_LIB_FILES`), relativ zu `src/lib`, sortiert.
 * Der Modul-Compiler bündelt im Browser Kopien davon (außer den geteilten) und lehnt alles andere ab.
 * @param {string} [libDir]
 * @returns {string[]}
 */
export function allowedLibFiles(libDir = LIB_DIR) {
	/** @type {string[]} */
	const out = [];
	const walk = (/** @type {string} */ dir) => {
		for (const name of readdirSync(dir)) {
			const p = join(dir, name);
			if (statSync(p).isDirectory()) walk(p);
			else if (SOURCE.test(name) && !SKIP.test(name))
				out.push(relative(libDir, p).replace(/\\/g, '/'));
		}
	};
	for (const d of HOST_LIB_DIRS) if (existsSync(join(libDir, d))) walk(join(libDir, d));
	for (const f of HOST_LIB_FILES) if (existsSync(join(libDir, f))) out.push(f);
	return out.sort();
}

/**
 * Registry-Schlüssel für eine aufgelöste Datei unter `src/lib` (oder `null`, wenn sie nicht zur Host-ABI gehört).
 * @param {string} absFile
 * @param {HostSide} side
 * @param {string} [libDir]
 */
export function hostKeyForFile(absFile, side, libDir = LIB_DIR) {
	const rel = relative(libDir, absFile).replace(/\\/g, '/');
	if (rel.startsWith('..')) return null;
	return hostLibFiles(side, libDir).includes(rel) ? `lib:${rel}` : null;
}

/**
 * Ladegruppe einer `$lib`-Datei: je UI-Baustein-Ordner, `components/layout`, `components/forms`, je SDK-Unterordner,
 * SDK-Einzeldateien, `forms`, `pdf-lists`, `utils`. Eine Gruppe ist **ein** dynamischer Einstieg im Build
 * (`export * as fN from …`, gleiche Instanzen wie im Core) – je Datei ein Einstieg würde den Core-Build in
 * Hunderte Kleinst-Chunks zerlegen.
 * Im Browser (wenige, kleine Dateien mit Zustand) bilden alle eine Gruppe – einzeln würde jede den Core-Build zerteilen.
 * @param {string} rel Pfad relativ zu `src/lib`
 * @param {HostSide} [side]
 */
export function hostGroupOf(rel, side = 'server') {
	if (side === 'client') return 'shared';
	const p = rel.split('/');
	if (p[0] === 'components' && p[1] === 'ui') return p.slice(0, 3).join('/');
	if (p[0] === 'components') return p.slice(0, 2).join('/');
	if (p[0] === 'sdk') return p.length > 2 ? p.slice(0, 2).join('/') : 'sdk';
	if (rel === 'utils.ts') return 'utils';
	return /** @type {string} */ (p[0]);
}

/**
 * Gruppen einer Seite: Name → Dateien (relativ zu `src/lib`, sortiert).
 * @param {HostSide} side
 * @param {string} [libDir]
 * @returns {Map<string, string[]>}
 */
export function hostGroups(side, libDir = LIB_DIR) {
	/** @type {Map<string, string[]>} */
	const out = new Map();
	for (const f of hostLibFiles(side, libDir)) {
		const g = hostGroupOf(f, side);
		out.set(g, [...(out.get(g) ?? []), f]);
	}
	return out;
}

/**
 * Import-Ziel eines geteilten Pakets (im Browser ggf. eine Weiterleitung mit weniger Exporten).
 * @param {string} pkg
 * @param {HostSide} side
 * @param {string} [libDir]
 */
export function hostPackageTarget(pkg, side, libDir = LIB_DIR) {
	const alias =
		side === 'client'
			? /** @type {Record<string, string>} */ (CLIENT_PACKAGE_TARGETS)[pkg]
			: undefined;
	return alias ? `${libDir}/${alias}` : pkg;
}

/**
 * Alle Registry-Schlüssel einer Seite mit Import-Ziel (Paketname oder absoluter Pfad).
 * @param {HostSide} side
 * @param {string} [libDir]
 * @returns {{ key: string, target: string }[]}
 */
export function hostEntries(side, libDir = LIB_DIR) {
	return [
		...HOST_PACKAGES[side].map((p) => ({ key: p, target: hostPackageTarget(p, side, libDir) })),
		...hostLibFiles(side, libDir).map((f) => ({ key: `lib:${f}`, target: `${libDir}/${f}` }))
	];
}

/**
 * Ladegruppe eines geteilten Pakets: alle `svelte/*` zusammen (die Laufzeit wird ohnehin gemeinsam gebraucht; einzeln
 * zerlegt jeder Unterpfad als eigener Einstieg die Laufzeit des Core in viele Chunks), alle `$app/*` zusammen, sonst je
 * Paket eine Gruppe.
 * @param {string} pkg
 */
export function hostPackageGroup(pkg) {
	if (pkg === 'svelte' || pkg.startsWith('svelte/')) return 'pkg/svelte';
	if (pkg.startsWith('$app/')) return 'pkg/app';
	return `pkg/${pkg}`;
}

/**
 * Alle Einträge einer Seite nach Ladegruppe: Gruppe → `[{ key, target }]` (Reihenfolge = Index `fN` im Gruppenmodul).
 * @param {HostSide} side
 * @param {string} [libDir]
 * @returns {Map<string, { key: string, target: string }[]>}
 */
export function hostGroupedEntries(side, libDir = LIB_DIR) {
	/** @type {Map<string, { key: string, target: string }[]>} */
	const out = new Map();
	const add = (/** @type {string} */ g, /** @type {{ key: string, target: string }} */ e) =>
		out.set(g, [...(out.get(g) ?? []), e]);
	for (const p of HOST_PACKAGES[side])
		add(hostPackageGroup(p), { key: p, target: hostPackageTarget(p, side, libDir) });
	for (const [g, files] of hostGroups(side, libDir))
		for (const f of files) add(`lib/${g}`, { key: `lib:${f}`, target: `${libDir}/${f}` });
	return out;
}

/**
 * Kennung der Host-ABI: ändert sie sich, passen vorkompilierte Modul-Bundles nicht mehr und werden neu gebaut.
 * Bestandteile: Core-Version, Svelte-Version (kompilierter Code hängt an der Laufzeit), Schlüssel beider Seiten.
 * @param {string} [root]
 */
export function hostAbiHash(root = CORE_ROOT) {
	const version = (/** @type {string} */ file) =>
		JSON.parse(readFileSync(join(root, file), 'utf8')).version;
	const h = createHash('sha256');
	h.update(`core ${version('package.json')}\n`);
	h.update(`svelte ${version('node_modules/svelte/package.json')}\n`);
	for (const side of /** @type {const} */ (['client', 'server'])) {
		for (const { key } of hostEntries(side)) h.update(`${side} ${key}\n`);
	}
	return `abi-${h.digest('hex').slice(0, 16)}`;
}
