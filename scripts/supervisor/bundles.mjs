// @ts-check
/**
 * Bundle-Ablage des Supervisors (Umbau „Module ohne App-Neubau“, Phase 4) – reine Teile, ohne Prozesse.
 *
 * `<data>/bundles/`:
 *   active.json                 { version: 1, modules: { <id>: { dir: "<id>/<build>" } } }   ← lädt die App
 *   active.prev.json            vorheriger Stand (Rückfall bei Absturz/fehlgeschlagener Health-Prüfung)
 *   active.next.json            Kandidat während des Probelaufs
 *   atrium-modules.lock.json    Herkunft je Modul (wie früher je Generation)
 *   failures.json               { <id>: { kind, message, package } } – letzter Kompilierfehler (Anzeige „Defekt“)
 *   <id>/<build>/               Ergebnis des Modul-Compilers + `src/` (Quelle für Neukompilieren nach Core-Updates)
 *
 * `<build>` = Inhaltshash + ABI-Kennung: gleiches Modul für denselben Core wird nie doppelt kompiliert.
 */
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ACTIVE_FILE = 'active.json';
export const PREV_FILE = 'active.prev.json';
export const NEXT_FILE = 'active.next.json';
export const LOCK_FILE = 'atrium-modules.lock.json';
export const FAILURES_FILE = 'failures.json';

/** @typedef {{ version: 1, modules: Record<string, { dir: string }> }} Active */
/** @typedef {{ version: string, sourceType: string, source: Record<string, unknown>, commit: string | null, contentHash: string }} LockEntry */
/** @typedef {{ lockVersion: 1, core: string, modules: Record<string, LockEntry> }} Lock */

/** Ordnername einer Build-Variante: gleiches Modul + gleiche ABI → gleicher Ordner */
export function bundleBuildId(/** @type {string} */ contentHash, /** @type {string} */ abi) {
	const h = String(contentHash)
		.replace(/^sha256-/, '')
		.slice(0, 12);
	const a = String(abi).replace(/^abi-/, '').slice(0, 8);
	if (!/^[0-9a-f]{12}$/.test(h) || !/^[0-9a-f]{8}$/.test(a))
		throw new Error(`Ungültige Kennung für ein Bundle (${contentHash}, ${abi})`);
	return `${h}-${a}`;
}

/**
 * @param {string} file
 * @param {any} fallback
 */
function readJson(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/** Atomar schreiben (temporäre Datei + Umbenennen) */
export function writeJsonAtomic(/** @type {string} */ file, /** @type {unknown} */ value) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(value, null, '\t'));
	renameSync(tmp, file);
}

/** @returns {Active} */
export function readActive(/** @type {string} */ bundlesDir, file = ACTIVE_FILE) {
	const data = readJson(join(bundlesDir, file), null);
	return { version: 1, modules: { ...(data?.modules ?? {}) } };
}

/** @returns {Lock} */
export function readLock(/** @type {string} */ bundlesDir, /** @type {string} */ coreVersion) {
	const data = readJson(join(bundlesDir, LOCK_FILE), null);
	return { lockVersion: 1, core: coreVersion, modules: { ...(data?.modules ?? {}) } };
}

/** `meta.json` eines Bundles (oder `null`) */
export function readMeta(/** @type {string} */ bundlesDir, /** @type {string} */ dir) {
	return readJson(join(bundlesDir, dir, 'meta.json'), null);
}

/**
 * Module, deren aktives Bundle nicht zur ABI des laufenden Core passt (oder fehlt/kaputt ist) – nach einem
 * Core-Update neu zu kompilieren, sofern die Quelle (`<build>/src`) vorliegt.
 * @param {string} bundlesDir
 * @param {Active} active
 * @param {string} abi
 * @returns {string[]}
 */
export function staleModules(bundlesDir, active, abi) {
	return Object.entries(active.modules)
		.filter(([, { dir }]) => readMeta(bundlesDir, dir)?.abi !== abi)
		.map(([id]) => id)
		.sort();
}

/**
 * Was ein Auftrag bewirkt: neue Liste aktiver Module, neue Lock-Datei und die Kompilier-Aufträge.
 * - `request.remove` fällt heraus, `request.modules` kommt aus dem Staging, `recompile` aus der gespeicherten Quelle.
 * - Ein Bundle, das es für (Inhalt, ABI) schon gibt, wird wiederverwendet (`reuse: true`, kein Kompilieren).
 * @param {{
 *   bundlesDir: string,
 *   active: Active,
 *   lock: Lock,
 *   request: { modules?: Record<string, LockEntry>, remove?: string[] },
 *   recompile?: string[],
 *   abi: string,
 *   stagingDir: string | null
 * }} o
 */
export function planCompile(o) {
	/** @type {Active} */
	const next = { version: 1, modules: { ...o.active.modules } };
	/** @type {Lock} */
	const nextLock = { ...o.lock, modules: { ...o.lock.modules } };
	/** @type {{ id: string, source: string, build: string, dir: string, reuse: boolean, requested: boolean }[]} */
	const jobs = [];
	for (const id of o.request.remove ?? []) {
		delete next.modules[id];
		delete nextLock.modules[id];
	}
	const add = (
		/** @type {string} */ id,
		/** @type {string} */ source,
		/** @type {LockEntry} */ entry,
		/** @type {boolean} */ requested
	) => {
		const build = bundleBuildId(entry.contentHash, o.abi);
		const dir = `${id}/${build}`;
		const meta = readMeta(o.bundlesDir, dir);
		const reuse = meta?.abi === o.abi && meta?.contentHash === entry.contentHash;
		jobs.push({ id, source, build, dir, reuse, requested });
		next.modules[id] = { dir };
		nextLock.modules[id] = entry;
	};
	for (const [id, entry] of Object.entries(o.request.modules ?? {})) {
		if (!o.stagingDir) throw new Error(`Auftrag ohne Staging für ${id}`);
		add(id, join(o.stagingDir, 'modules', id), entry, true);
	}
	for (const id of o.recompile ?? []) {
		if (o.request.modules?.[id] || o.request.remove?.includes(id)) continue;
		const current = o.active.modules[id];
		const entry = o.lock.modules[id];
		if (!current || !entry) continue;
		add(id, join(o.bundlesDir, current.dir, 'src'), entry, false);
	}
	return { next, nextLock, jobs };
}

/**
 * Build-Ordner, die weder aktiv noch im vorherigen Stand stehen (Aufräumen nach erfolgreichem Tausch).
 * @param {string} bundlesDir
 * @param {Active[]} keep
 * @returns {string[]} relative Ordner `<id>/<build>`
 */
export function unreferencedBuilds(bundlesDir, keep) {
	const used = new Set(keep.flatMap((a) => Object.values(a.modules).map((m) => m.dir)));
	const out = [];
	if (!existsSync(bundlesDir)) return out;
	for (const id of readdirSync(bundlesDir, { withFileTypes: true })) {
		if (!id.isDirectory()) continue;
		for (const build of readdirSync(join(bundlesDir, id.name), { withFileTypes: true })) {
			if (!build.isDirectory()) continue;
			const dir = `${id.name}/${build.name}`;
			if (!used.has(dir)) out.push(dir);
		}
	}
	return out.sort();
}
