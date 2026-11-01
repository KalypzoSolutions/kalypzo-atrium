/**
 * Seed für frische Deployments (Kalypzo Atrium, Phase 7): Liste der Module, die ein neuer Server beim ersten Start
 * selbst holt und baut – Quelle + **fester Commit**, optional Inhaltshashes.
 *
 * Datei `deploy/modules.seed.json` im Core, Pfad in `ATRIUM_MODULES_SEED` oder dort direkt das JSON:
 *   { "schema": 1, "sources": [ { "source": "github:org/ep-intern-modules", "commit": "<sha40>",
 *       "modules": ["members", "actions"], "contentHashes": { "members": "sha256-…" } } ] }
 * `modules` fehlt = alle Module der Quelle (Katalog bzw. `modules/*`).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/;
const SOURCE_RE = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)((?:\/[A-Za-z0-9_.-]+)*)$/;
const ID_RE = /^[a-z][a-z0-9-]{1,30}$/;

/** Seed lesen und prüfen; `null`, wenn keiner vorhanden ist */
export function readSeed(coreRoot, env = process.env) {
	const value = env.ATRIUM_MODULES_SEED?.trim();
	// Direkt als JSON (praktisch in Compose/Dokploy), sonst Dateipfad
	if (value?.startsWith('{')) {
		return {
			...parseSeed(JSON.parse(value)),
			hash: createHash('sha256').update(value).digest('hex')
		};
	}
	const file = value || join(coreRoot, 'deploy', 'modules.seed.json');
	if (!existsSync(file)) return null;
	const raw = readFileSync(file, 'utf8');
	return { ...parseSeed(JSON.parse(raw)), hash: createHash('sha256').update(raw).digest('hex') };
}

export function parseSeed(json) {
	if (!json || json.schema !== 1 || !Array.isArray(json.sources)) {
		throw new Error('Seed: erwartet { "schema": 1, "sources": [...] }');
	}
	const sources = json.sources.map((s, i) => {
		const m = SOURCE_RE.exec(String(s?.source ?? ''));
		if (!m) throw new Error(`Seed: sources[${i}].source muss github:owner/repo[/pfad] sein`);
		if (!SHA_RE.test(String(s.commit ?? ''))) {
			throw new Error(`Seed: sources[${i}].commit muss ein voller Commit (40 Zeichen) sein`);
		}
		const modules = s.modules === undefined ? null : s.modules;
		if (modules !== null && (!Array.isArray(modules) || modules.some((id) => !ID_RE.test(id)))) {
			throw new Error(`Seed: sources[${i}].modules muss eine Liste von Modul-IDs sein`);
		}
		return {
			owner: m[1],
			repo: m[2],
			path: m[3].replace(/^\//, ''),
			commit: s.commit,
			modules,
			contentHashes: s.contentHashes ?? {}
		};
	});
	return { sources };
}

function safePath(p) {
	return (
		!p.includes('\\') &&
		!p.startsWith('/') &&
		!p.includes('\0') &&
		p.split('/').every((s) => s !== '..' && s !== '.' && !s.startsWith('.') && s !== 'node_modules')
	);
}

/**
 * Module aus einem ZIP (GitHub-zipball) unterhalb von `path` lesen: Katalog → `modules/*` / `*` → Einzelmodul.
 * Liefert `{ id: { dir, files: Map<relPfad, Uint8Array>, pkg } }`; unsichere Pfade brechen ab.
 */
export function extractSeedModules(zip, path, wanted, coreRoot) {
	const { unzipSync } = createRequire(join(coreRoot, 'package.json'))('fflate');
	const all = unzipSync(zip);
	const names = Object.keys(all).filter((n) => !n.endsWith('/'));
	const tops = new Set(names.map((n) => n.split('/')[0]));
	const strip = tops.size === 1 && names.every((n) => n.includes('/'));
	const files = new Map();
	for (const n of names) {
		const rel = strip ? n.slice(n.indexOf('/') + 1) : n;
		if (!safePath(rel)) throw new Error(`Seed: unsicherer Pfad im Archiv: ${rel.slice(0, 120)}`);
		files.set(rel, all[n]);
	}
	const base = path ? `${path}/` : '';
	const text = (p) => (files.has(p) ? new TextDecoder().decode(files.get(p)) : null);
	let dirs = [];
	const catalog = text(`${base}atrium-modules.json`);
	if (catalog) {
		dirs = JSON.parse(catalog).modules.map((m) => `${base}${m.path}`);
	} else if (files.has(`${base}atrium-module.json`)) {
		dirs = [base.replace(/\/$/, '')];
	} else {
		for (const k of files.keys()) {
			const m = /^(.*\/)?([^/]+)\/atrium-module\.json$/.exec(k);
			if (!m || !k.startsWith(base)) continue;
			const rest = k.slice(base.length).split('/');
			if (rest.length === 2 || (rest.length === 3 && rest[0] === 'modules')) {
				dirs.push(k.slice(0, -'/atrium-module.json'.length));
			}
		}
	}
	const out = {};
	for (const dir of dirs) {
		const pkg = JSON.parse(text(`${dir ? `${dir}/` : ''}atrium-module.json`) ?? 'null');
		if (!pkg?.id || !ID_RE.test(pkg.id)) continue;
		if (wanted && !wanted.includes(pkg.id)) continue;
		const prefix = dir ? `${dir}/` : '';
		const own = new Map();
		for (const [k, v] of files) if (k.startsWith(prefix)) own.set(k.slice(prefix.length), v);
		out[pkg.id] = { dir, files: own, pkg };
	}
	for (const id of wanted ?? []) {
		if (!out[id]) throw new Error(`Seed: Modul ${id} ist in der Quelle nicht enthalten`);
	}
	return out;
}

/** Module eines Moduls in einen Ordner schreiben */
export function writeModuleFiles(dir, files) {
	for (const [rel, data] of files) {
		const target = join(dir, rel);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, data);
	}
}

/** Archiv am Commit von GitHub laden (Token optional über GITHUB_TOKEN/ATRIUM_GITHUB_TOKEN) */
export async function downloadZipball(owner, repo, commit, env = process.env) {
	const token = env.ATRIUM_GITHUB_TOKEN || env.GITHUB_TOKEN;
	const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/zipball/${commit}`, {
		headers: {
			accept: 'application/vnd.github+json',
			'user-agent': 'kalypzo-atrium',
			...(token ? { authorization: `Bearer ${token}` } : {})
		},
		redirect: 'follow',
		signal: AbortSignal.timeout(60_000)
	});
	if (!res.ok) throw new Error(`GitHub antwortet mit ${res.status} für ${owner}/${repo}@${commit}`);
	const host = new URL(res.url).hostname;
	if (!['api.github.com', 'codeload.github.com'].includes(host)) {
		throw new Error(`Unerwartete Weiterleitung nach ${host}`);
	}
	const buf = new Uint8Array(await res.arrayBuffer());
	if (buf.byteLength > 50 * 1024 * 1024) throw new Error('Archiv größer als 50 MB');
	return buf;
}
