/**
 * Vorkompilierte Modul-Bundles (Umbau „Module ohne App-Neubau“, Phase 3): Module, die nicht in den App-Build
 * hineinkompiliert sind, sondern einzeln vom Modul-Compiler (`scripts/module-compiler`) übersetzt wurden.
 *
 * Ablage `ATRIUM_DATA_DIR/bundles/`:
 *   active.json                     { version: 1, modules: { <id>: { dir: "<id>/<build>" } } }
 *   <id>/<build>/meta.json          Ergebnis des Compilers (`ModuleBundleMeta`)
 *   <id>/<build>/server/…, client/… Bundles
 *
 * Laden: ABI prüfen → Host-Einträge vorladen → `server/module.js` importieren → wie eingebaute Module registrieren.
 * Jeder Fehler macht nur das eine Modul „defekt“. Die Oberfläche liefert `moduleUiLoader` (Server: SSR-Bundle,
 * Browser: `/_atrium/modules/<id>/<build>/client/…`, Liste über die Layout-Daten).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { abi as hostAbi, host } from 'virtual:atrium-host/server';
import { addMessages, type Locale, type LocalizedText } from '$lib/i18n';
import type { ModuleUi } from '$lib/sdk/types/module-ui';
import { setServerUiResolver } from '$lib/sdk/client/module-ui-registry';
import type { ModuleBundleMeta } from '../../../../../../scripts/module-compiler/lib.mjs';
import { getDefinition, markModuleBroken, registerModule } from '../registry';
import type { ModuleDefinition } from '../types';
import { conventionMessageFor, importProblem } from '../load';
import { utilitiesCss } from './utilities';

export const BUNDLE_ACTIVE_FILE = 'active.json';
/** Öffentlicher Pfad der Browser-Dateien eines Bundles */
export const BUNDLE_URL_PREFIX = '/_atrium/modules/';
const BUILD_RE = /^[A-Za-z0-9_.-]{1,120}$/;
const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export interface ActiveBundles {
	version: 1;
	modules: Record<string, { dir: string }>;
}

export interface LoadedBundle {
	id: string;
	/** Ordnername der Build-Variante (`<id>/<build>`) */
	build: string;
	dir: string;
	meta: ModuleBundleMeta;
}

/** Für den Browser: woher die Oberfläche und das CSS eines Bundles kommen */
export interface ClientBundle {
	id: string;
	/** URL-Präfix der Browser-Dateien, endet auf `/` */
	base: string;
	entry: string;
	css: string[];
	host: string[];
}

const loaded = new Map<string, LoadedBundle>();

/**
 * Ablage der Bundles: `ATRIUM_BUNDLES_DIR` (ausdrücklich, z. B. E2E), sonst `ATRIUM_DATA_DIR/bundles`, sonst `null`
 */
export function bundlesRoot(): string | null {
	const explicit = process.env.ATRIUM_BUNDLES_DIR?.trim();
	if (explicit) return resolve(explicit);
	const d = process.env.ATRIUM_DATA_DIR?.trim();
	return d ? resolve(d, 'bundles') : null;
}

/**
 * Datei der aktiven Liste: `active.json`; im Probelauf des Supervisors die Kandidaten-Liste (`ATRIUM_BUNDLES_ACTIVE`,
 * nur ein einfacher Dateiname)
 */
function activeFileName(): string {
	const f = process.env.ATRIUM_BUNDLES_ACTIVE?.trim();
	return f && /^[a-z0-9.-]+\.json$/.test(f) ? f : BUNDLE_ACTIVE_FILE;
}

/** Letzter Kompilierfehler je Modul (`failures.json` des Supervisors) */
function readFailures(root: string): Record<string, { message?: string }> {
	try {
		return JSON.parse(readFileSync(join(root, 'failures.json'), 'utf8')) as Record<
			string,
			{ message?: string }
		>;
	} catch {
		return {};
	}
}

/** `active.json` lesen (fehlend/ungültig → keine Bundles) */
export function readActiveBundles(root = bundlesRoot()): ActiveBundles {
	if (!root) return { version: 1, modules: {} };
	const file = join(root, activeFileName());
	if (!existsSync(file)) return { version: 1, modules: {} };
	try {
		const data = JSON.parse(readFileSync(file, 'utf8')) as Partial<ActiveBundles>;
		const modules: ActiveBundles['modules'] = {};
		for (const [id, entry] of Object.entries(data.modules ?? {})) {
			const [folder, build, ...rest] = String(entry?.dir ?? '').split('/');
			if (ID_RE.test(id) && folder === id && build && BUILD_RE.test(build) && !rest.length)
				modules[id] = { dir: `${id}/${build}` };
			else console.error(`[modules] ${BUNDLE_ACTIVE_FILE}: ungültiger Eintrag für „${id}“`);
		}
		return { version: 1, modules };
	} catch (e) {
		console.error(`[modules] ${BUNDLE_ACTIVE_FILE} nicht lesbar:`, e);
		return { version: 1, modules: {} };
	}
}

/**
 * Aktive Bundles laden und registrieren (nach den eingebauten Modulen; gleiche ID eingebaut → eingebaut gewinnt).
 * @returns IDs der registrierten Bundle-Module
 */
export async function loadBundleModules(root = bundlesRoot()): Promise<string[]> {
	if (!root) return [];
	const out: string[] = [];
	const failures = readFailures(root);
	for (const [id, { dir }] of Object.entries(readActiveBundles(root).modules)) {
		if (getDefinition(id) || loaded.has(id)) continue;
		const bundleDir = join(root, dir);
		// Anzeigename aus meta.json, sobald gelesen (sonst die ID)
		let name: LocalizedText = id;
		const broken = (
			reason: Parameters<typeof markModuleBroken>[0]['reason'],
			version: string | null = null
		) => markModuleBroken({ id, name, version, reason });
		let meta: ModuleBundleMeta;
		try {
			meta = JSON.parse(readFileSync(join(bundleDir, 'meta.json'), 'utf8')) as ModuleBundleMeta;
		} catch (e) {
			broken({ key: 'modules.broken.bundleMissing', params: { dir } });
			console.error(`[modules] Bundle ${dir}: ${e instanceof Error ? e.message : String(e)}`);
			continue;
		}
		if (meta.metaVersion !== 1 || meta.id !== id) {
			broken({ key: 'modules.broken.bundleMissing', params: { dir } }, meta.version ?? null);
			continue;
		}
		if (meta.name) name = meta.name;
		if (meta.abi !== hostAbi) {
			// Neukompilieren für den neuen Core läuft (Supervisor) oder ist gescheitert – dann mit dessen Grund
			const failed = failures[id]?.message;
			broken(
				failed
					? { key: 'modules.broken.compileFailed', params: { error: failed.slice(0, 300) } }
					: { key: 'modules.broken.bundleOutdated', params: {} },
				meta.version
			);
			continue;
		}
		let definition: ModuleDefinition | undefined;
		try {
			await host.preload(meta.server.moduleHost);
			definition = (
				(await import(
					/* @vite-ignore */ pathToFileURL(join(bundleDir, meta.server.module)).href
				)) as {
					default?: ModuleDefinition;
				}
			).default;
		} catch (e) {
			broken(importProblem(e), meta.version);
			continue;
		}
		const problem = conventionMessageFor(id, definition, meta.migrations);
		if (problem || !definition) {
			broken(problem ?? { key: 'modules.convention.noDefinition' }, meta.version);
			continue;
		}
		try {
			registerModule(definition);
		} catch (e) {
			broken(e instanceof Error ? e.message : String(e), meta.version);
			continue;
		}
		for (const [locale, messages] of Object.entries(meta.messages ?? {}))
			addMessages(id, locale as Locale, messages as Record<string, unknown>);
		loaded.set(id, { id, build: dir.split('/')[1]!, dir: bundleDir, meta });
		out.push(id);
	}
	return out;
}

/** Geladenes Bundle eines Moduls (oder `undefined`, z. B. eingebautes Modul) */
export function loadedBundle(id: string): LoadedBundle | undefined {
	return loaded.get(id);
}

/** Browser-Angaben aller geladenen Bundles (Layout-Daten) */
export function clientBundles(): ClientBundle[] {
	return [...loaded.values()]
		.filter((b) => getDefinition(b.id))
		.map((b) => ({
			id: b.id,
			base: `${BUNDLE_URL_PREFIX}${b.id}/${b.build}/`,
			entry: b.meta.client.entry,
			css: b.meta.client.css,
			host: b.meta.client.host
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

/** Pfad-Teil des gemeinsamen Utilities-CSS (`/_atrium/modules/_utilities/<hash>/utilities.css`) */
export const UTILITIES_ID = '_utilities';
export const UTILITIES_FILE = 'utilities.css';

/**
 * Gemeinsames Utilities-CSS (Core + geladene Bundles, `utilities.ts`) mit seiner URL, oder `null` (keine Bundles
 * bzw. Tailwind nicht verfügbar)
 */
export async function bundleUtilities(): Promise<{
	url: string;
	hash: string;
	css: string;
} | null> {
	const candidates = [...loaded.values()]
		.filter((b) => getDefinition(b.id))
		.map((b) => b.meta.client.tailwind ?? []);
	const u = await utilitiesCss(candidates);
	return u
		? { ...u, url: `${BUNDLE_URL_PREFIX}${UTILITIES_ID}/${u.hash}/${UTILITIES_FILE}` }
		: null;
}

/**
 * Datei eines geladenen Bundles für die Auslieferung an den Browser (`file` relativ zum Bundle-Ordner, wie in
 * `meta.json`, z. B. `client/ui.js`): nur unter `client/`, nur geladene Builds, keine Pfad-Ausbrüche. Sonst `null`.
 */
export function bundleClientFile(id: string, build: string, file: string): string | null {
	const b = loaded.get(id);
	if (!b || b.build !== build) return null;
	const clientDir = resolve(b.dir, 'client');
	const target = resolve(b.dir, file);
	if (!target.startsWith(clientDir + sep) || !existsSync(target)) return null;
	return target;
}

/** SSR: Oberfläche eines Bundle-Moduls (Host-Einträge vorladen, `server/ui.js` importieren) */
function serverUiLoader(id: string): (() => Promise<{ default: ModuleUi }>) | undefined {
	const b = loaded.get(id);
	if (!b?.meta.server.ui) return undefined;
	const file = pathToFileURL(join(b.dir, b.meta.server.ui)).href;
	return async () => {
		await host.preload(b.meta.server.uiHost);
		return (await import(/* @vite-ignore */ file)) as { default: ModuleUi };
	};
}

setServerUiResolver(serverUiLoader);

/** Nur für Tests: geladene Bundles vergessen */
export function resetLoadedBundlesForTests(): void {
	loaded.clear();
}
