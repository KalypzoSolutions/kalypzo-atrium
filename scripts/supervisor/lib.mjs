/**
 * Supervisor für Kalypzo Atrium (Phase 6): startet die gebaute App als Kindprozess und baut sie auf Wunsch neu,
 * wenn im Panel Module installiert werden.
 *
 * Datenverzeichnis (`dataDir`, im Container ein Volume):
 *   state.json                         { current, previous } – laufende und vorige Generation
 *   status.json                        Stand für das Panel (state, step, message, logTail …)
 *   gen/<id>/modules/                  Module dieser Generation (echte Dateien) + node_modules für Modul-Pakete
 *   gen/<id>/node_modules  → Core      Junction/Symlink, damit Moduldateien die Pakete des Core finden
 *   gen/<id>/build/                    adapter-node-Ausgabe
 *   gen/<id>/.svelte-kit/              Arbeitsordner von SvelteKit (Core bleibt schreibgeschützt)
 *   gen/<id>/BUILD_INFO.json, atrium-modules.lock.json
 *   staging/<planId>/request.json + modules/<id>/…   Auftrag der App
 *   results/<planId>.json              Ergebnis (liest die App beim Start)
 *   logs/<id>.log                      Build-Protokoll
 *
 * Ohne Generation läuft der mitgelieferte Build (`baseBuildDir`, Module `baseModulesDir`).
 * Ablauf eines Neubaus: Module kopieren + Auftrag einspielen → Modul-Pakete (npm) → `svelte-kit sync` + `vite build`
 * → Probelauf (`ATRIUM_VERIFY_ONLY=1`) → Tausch → Neustart → Health-Prüfung → sonst Rückkehr zur vorigen Generation.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { downloadZipball, extractSeedModules, readSeed, writeModuleFiles } from './seed.mjs';

export const VERIFY_PREFIX = 'ATRIUM_VERIFY ';
const PLAN_RE = /^[A-Za-z0-9_-]{8,80}$/;
const STOP_TIMEOUT_MS = 30_000;
const LOG_TAIL = 40;

/** Inhaltshash eines Ordners – gleiche Regel wie `contentHash` in `core/modules/install/archive.ts` */
export function contentHashOfDir(dir) {
	const files = [];
	const walk = (d) => {
		for (const name of readdirSync(d)) {
			const p = join(d, name);
			if (statSync(p).isDirectory()) {
				if (name !== 'node_modules') walk(p);
			} else files.push(relative(dir, p).split('\\').join('/'));
		}
	};
	walk(dir);
	files.sort();
	const h = createHash('sha256');
	for (const f of files) {
		const data = readFileSync(join(dir, f));
		h.update(f);
		h.update('\0');
		h.update(String(data.byteLength));
		h.update('\0');
		h.update(data);
	}
	return `sha256-${h.digest('hex')}`;
}

/** Modulordner (mit `module.ts`) in `dir` */
export function moduleFolders(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'module.ts')))
		.map((e) => e.name)
		.sort();
}

/**
 * npm-Pakete der Module, die der Core nicht mitbringt: `{ name: version }`. Gleiches Paket in verschiedenen
 * Versionen → Fehler (die Vorschau sperrt das bereits).
 */
export function modulePackagesFor(modulesDir, corePkg) {
	const known = new Set([
		...Object.keys(corePkg.dependencies ?? {}),
		...Object.keys(corePkg.devDependencies ?? {})
	]);
	const out = {};
	for (const id of moduleFolders(modulesDir)) {
		const file = join(modulesDir, id, 'atrium-module.json');
		if (!existsSync(file)) continue;
		const npm = JSON.parse(readFileSync(file, 'utf8')).npm ?? {};
		for (const [name, version] of Object.entries(npm)) {
			if (known.has(name)) continue;
			if (out[name] && out[name] !== version) {
				throw new Error(`npm-Paket ${name} in verschiedenen Versionen (${out[name]} / ${version})`);
			}
			out[name] = version;
		}
	}
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Lock-Datei der neuen Generation: bisheriger Stand + Auftrag; Module ohne Eintrag als `builtin` */
export function mergeLock(prev, request, modulesDir, coreVersion) {
	const modules = { ...(prev?.modules ?? {}) };
	for (const id of request?.remove ?? []) delete modules[id];
	for (const [id, entry] of Object.entries(request?.modules ?? {})) modules[id] = entry;
	const present = new Set(moduleFolders(modulesDir));
	for (const id of Object.keys(modules)) if (!present.has(id)) delete modules[id];
	for (const id of present) {
		if (modules[id]) continue;
		const pkg = JSON.parse(readFileSync(join(modulesDir, id, 'atrium-module.json'), 'utf8'));
		modules[id] = {
			version: pkg.version,
			sourceType: 'builtin',
			source: {},
			commit: null,
			contentHash: contentHashOfDir(join(modulesDir, id))
		};
	}
	return {
		lockVersion: 1,
		core: coreVersion,
		modules: Object.fromEntries(Object.entries(modules).sort(([a], [b]) => a.localeCompare(b)))
	};
}

function readJson(file, fallback = null) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

/** Atomar schreiben (temporäre Datei + Umbenennen) */
function writeJson(file, value) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, JSON.stringify(value, null, '\t'));
	renameSync(tmp, file);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Supervisor {
	/**
	 * @param {{
	 *   coreRoot: string,
	 *   dataDir: string,
	 *   env?: Record<string, string | undefined>,
	 *   baseModulesDir?: string,
	 *   baseBuildDir?: string,
	 *   healthTimeoutMs?: number,
	 *   buildHeapMb?: number,
	 *   log?: (msg: string) => void
	 * }} opts
	 */
	constructor(opts) {
		this.coreRoot = resolve(opts.coreRoot);
		this.dataDir = resolve(opts.dataDir);
		this.env = { ...process.env, ...(opts.env ?? {}) };
		this.baseModulesDir = resolve(opts.baseModulesDir ?? join(this.coreRoot, 'modules'));
		this.baseBuildDir = resolve(opts.baseBuildDir ?? join(this.coreRoot, 'build'));
		this.healthTimeoutMs = opts.healthTimeoutMs ?? 120_000;
		this.buildHeapMb = opts.buildHeapMb ?? Number(this.env.ATRIUM_BUILD_HEAP ?? 3072);
		this.log = opts.log ?? ((m) => console.log(`[supervisor] ${m}`));
		/** GitHub-Archiv laden (für Tests ersetzbar) */
		this.download = opts.download ?? downloadZipball;
		this.corePkg = readJson(join(this.coreRoot, 'package.json'), {});
		/** @type {import('node:child_process').ChildProcess | null} */
		this.child = null;
		this.expectedExit = false;
		this.crashes = [];
		this.queue = Promise.resolve();
		this.stopping = false;
		for (const d of ['gen', 'staging', 'results', 'logs', 'cache', 'tmp']) {
			mkdirSync(join(this.dataDir, d), { recursive: true });
		}
	}

	get port() {
		return Number(this.env.PORT ?? 3000);
	}

	// --- Zustand ---------------------------------------------------------------------------------

	state() {
		return readJson(join(this.dataDir, 'state.json'), { current: null, previous: null });
	}

	/** Zustand ändern (zusammenführen: `seed` u. a. bleiben erhalten) */
	setState(s) {
		writeJson(join(this.dataDir, 'state.json'), { ...this.state(), ...s });
	}

	genDir(id) {
		return join(this.dataDir, 'gen', id);
	}

	/** Laufzeitordner einer Generation (`null` = mitgelieferter Build) */
	runtime(id) {
		if (!id) return { id: 'base', build: this.baseBuildDir, modules: this.baseModulesDir };
		return { id, build: join(this.genDir(id), 'build'), modules: join(this.genDir(id), 'modules') };
	}

	status(patch) {
		const file = join(this.dataDir, 'status.json');
		const next = { ...readJson(file, {}), ...patch };
		writeJson(file, next);
		return next;
	}

	// --- Kindprozess -----------------------------------------------------------------------------

	childEnv(rt, extra = {}) {
		return {
			...this.env,
			ATRIUM_SUPERVISOR: '1',
			ATRIUM_DATA_DIR: this.dataDir,
			ATRIUM_GENERATION: rt.id,
			ATRIUM_MODULES_DIR: rt.modules,
			ATRIUM_MODULE_INSTALL: this.env.ATRIUM_MODULE_INSTALL ?? 'supervisor',
			...extra
		};
	}

	startChild(genId) {
		const rt = this.runtime(genId);
		const entry = join(rt.build, 'index.js');
		if (!existsSync(entry)) throw new Error(`Kein Build gefunden: ${entry}`);
		this.log(`Starte App (Generation ${rt.id})`);
		this.expectedExit = false;
		const child = spawn(process.execPath, [entry], {
			cwd: this.coreRoot,
			env: this.childEnv(rt),
			stdio: ['inherit', 'inherit', 'inherit', 'ipc']
		});
		this.child = child;
		child.on('message', (m) => this.onMessage(m));
		child.on('exit', (code, signal) => {
			if (this.child === child) this.child = null;
			if (this.expectedExit || this.stopping) return;
			this.log(`App beendet (Code ${code ?? signal}) – Neustart`);
			this.onCrash();
		});
		return child;
	}

	onCrash() {
		const now = Date.now();
		this.crashes = [...this.crashes.filter((t) => now - t < 60_000), now];
		if (this.crashes.length > 5) {
			const { current, previous } = this.state();
			if (current && previous !== undefined) {
				this.log('App stürzt wiederholt ab – zurück zur vorigen Generation');
				this.setState({ current: previous ?? null, previous: null });
				this.crashes = [];
			} else {
				this.log('App stürzt wiederholt ab – Supervisor beendet sich');
				process.exit(1);
			}
		}
		setTimeout(() => {
			if (!this.child && !this.stopping) this.startChild(this.state().current);
		}, 2000).unref();
	}

	/** Kind geordnet beenden (IPC, dann Signal, zuletzt hart) */
	async stopChild() {
		const child = this.child;
		if (!child) return;
		this.expectedExit = true;
		const exited = new Promise((r) => child.once('exit', r));
		try {
			child.send({ type: 'atrium:shutdown' });
		} catch {
			child.kill('SIGTERM');
		}
		const timer = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS);
		await exited;
		clearTimeout(timer);
		this.child = null;
	}

	async waitHealthy() {
		const until = Date.now() + this.healthTimeoutMs;
		while (Date.now() < until) {
			if (!this.child) return false;
			try {
				const res = await fetch(`http://127.0.0.1:${this.port}/api/v1/health`, {
					signal: AbortSignal.timeout(3000)
				});
				if (res.ok) return true;
			} catch {
				// startet noch
			}
			await sleep(1000);
		}
		return false;
	}

	onMessage(m) {
		if (!m || typeof m !== 'object' || m.type !== 'atrium:build') return;
		const planId = String(m.planId ?? '');
		if (
			!PLAN_RE.test(planId) ||
			!existsSync(join(this.dataDir, 'staging', planId, 'request.json'))
		) {
			this.log(`Ungültiger Bauauftrag ignoriert: ${planId.slice(0, 80)}`);
			return;
		}
		this.status({ state: 'queued', planId, step: 'Wartet', message: null, finishedAt: null });
		this.enqueue(() => this.build(planId));
	}

	enqueue(fn) {
		this.queue = this.queue.then(fn).catch((e) => this.log(`Fehler: ${e?.message ?? e}`));
		return this.queue;
	}

	// --- Start/Stopp -----------------------------------------------------------------------------

	async start() {
		let { current } = this.state();
		if (current && !existsSync(join(this.genDir(current), 'build', 'index.js'))) {
			this.log(`Generation ${current} fehlt – nutze den mitgelieferten Build`);
			current = null;
			this.setState({ current: null, previous: null });
		}
		this.status({ state: 'idle', running: current ?? 'base', step: null });
		this.startChild(current);
		// Neue Core-Version (neues Image): Module der Generation mit dem neuen Core neu bauen
		const info = current ? readJson(join(this.genDir(current), 'BUILD_INFO.json'), {}) : null;
		if (info && info.core !== this.corePkg.version) {
			this.log(`Core ${info.core} → ${this.corePkg.version}: Neubau der Generation`);
			this.enqueue(() => this.build(null));
		}
		// Frisches Deployment: Module aus der Seed-Liste holen und bauen (einmal je Seed-Inhalt)
		if (!current) {
			let seed = null;
			try {
				seed = readSeed(this.coreRoot, this.env);
			} catch (e) {
				this.log(`Seed ungültig: ${e?.message ?? e}`);
			}
			if (seed && this.state().seed !== seed.hash) this.enqueue(() => this.applySeed(seed));
		}
	}

	/** Module der Seed-Liste von GitHub holen (fester Commit), als Auftrag ablegen und bauen */
	async applySeed(seed) {
		const planId = `seed${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
		const root = join(this.dataDir, 'staging', planId);
		const request = {
			planId,
			requestedBy: 'seed',
			requestedAt: new Date().toISOString(),
			modules: {},
			remove: []
		};
		try {
			this.status({
				state: 'building',
				planId,
				step: 'Module aus der Seed-Liste laden',
				message: null
			});
			for (const src of seed.sources) {
				const zip = await this.download(src.owner, src.repo, src.commit, this.env);
				const mods = extractSeedModules(zip, src.path, src.modules, this.coreRoot);
				for (const [id, m] of Object.entries(mods)) {
					const dir = join(root, 'modules', id);
					writeModuleFiles(dir, m.files);
					const hash = contentHashOfDir(dir);
					const expected = src.contentHashes[id];
					if (expected && expected !== hash) throw new Error(`Seed: Inhalt von ${id} weicht ab`);
					request.modules[id] = {
						version: m.pkg.version,
						sourceType: 'github',
						source: { owner: src.owner, repo: src.repo, path: m.dir, ref: src.commit },
						commit: src.commit,
						contentHash: hash
					};
				}
			}
			mkdirSync(root, { recursive: true });
			writeJson(join(root, 'request.json'), request);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.finish(planId, null, 'failed', message, [message]);
			return;
		}
		await this.build(planId);
		if (this.state().current) this.setState({ seed: seed.hash });
	}

	async stop() {
		this.stopping = true;
		await this.stopChild();
	}

	// --- Neubau ----------------------------------------------------------------------------------

	/** `planId = null`: nur mit neuem Core neu bauen (keine Moduländerung) */
	async build(planId) {
		const startedAt = new Date().toISOString();
		const genId = `g${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
		const genDir = this.genDir(genId);
		const logFile = join(this.dataDir, 'logs', `${genId}.log`);
		const tail = [];
		const write = (line) => {
			appendFileSync(logFile, `${line}\n`);
			for (const l of String(line).split(/\r?\n/)) if (l.trim()) tail.push(l.slice(0, 300));
			while (tail.length > LOG_TAIL) tail.shift();
		};
		const step = (name) => {
			write(`== ${name}`);
			this.log(`${planId ?? 'Neubau'}: ${name}`);
			this.status({
				state: 'building',
				planId,
				generation: genId,
				step: name,
				startedAt,
				logTail: tail
			});
		};
		const prev = this.state();
		const prevRt = this.runtime(prev.current);
		try {
			const request = planId
				? readJson(join(this.dataDir, 'staging', planId, 'request.json'))
				: { modules: {}, remove: [] };
			if (!request) throw new Error('Auftrag nicht lesbar');

			step('Module zusammenstellen');
			const modulesDir = join(genDir, 'modules');
			mkdirSync(modulesDir, { recursive: true });
			if (existsSync(prevRt.modules)) {
				cpSync(prevRt.modules, modulesDir, {
					recursive: true,
					filter: (src) => !src.split(/[\\/]/).includes('node_modules')
				});
			}
			for (const id of request.remove ?? [])
				rmSync(join(modulesDir, id), { recursive: true, force: true });
			for (const id of Object.keys(request.modules ?? {})) {
				rmSync(join(modulesDir, id), { recursive: true, force: true });
				cpSync(join(this.dataDir, 'staging', planId, 'modules', id), join(modulesDir, id), {
					recursive: true
				});
			}
			const prevLock = prev.current
				? readJson(join(this.genDir(prev.current), 'atrium-modules.lock.json'))
				: null;
			const lock = mergeLock(prevLock, request, modulesDir, this.corePkg.version);
			// Stimmen die eingespielten Dateien mit der Vorschau überein?
			for (const [id, entry] of Object.entries(request.modules ?? {})) {
				const actual = contentHashOfDir(join(modulesDir, id));
				if (actual !== entry.contentHash)
					throw new Error(`Inhalt von ${id} weicht von der Vorschau ab`);
			}

			step('Pakete der Module');
			const packages = modulePackagesFor(modulesDir, this.corePkg);
			if (Object.keys(packages).length) {
				writeJson(join(modulesDir, 'package.json'), { private: true, dependencies: packages });
				const prevPkgs = readJson(join(prevRt.modules, 'package.json'), {})?.dependencies ?? {};
				if (
					JSON.stringify(prevPkgs) === JSON.stringify(packages) &&
					existsSync(join(prevRt.modules, 'node_modules'))
				) {
					cpSync(join(prevRt.modules, 'node_modules'), join(modulesDir, 'node_modules'), {
						recursive: true
					});
				} else {
					await this.run(
						process.platform === 'win32' ? 'npm.cmd' : 'npm',
						[
							'install',
							'--ignore-scripts',
							'--no-audit',
							'--no-fund',
							'--legacy-peer-deps',
							'--omit=dev'
						],
						{ cwd: modulesDir, write, shell: process.platform === 'win32' }
					);
				}
			} else write('keine eigenen Pakete');
			// Moduldateien finden die Pakete des Core über diesen Link (Junction unter Windows)
			symlinkSync(join(this.coreRoot, 'node_modules'), join(genDir, 'node_modules'), 'junction');

			step('App bauen');
			const buildEnv = {
				...this.env,
				ATRIUM_MODULES_DIR: modulesDir,
				ATRIUM_BUILD_OUT: join(genDir, 'build'),
				ATRIUM_KIT_OUT_DIR: join(genDir, '.svelte-kit'),
				ATRIUM_VITE_CACHE: join(this.dataDir, 'cache', 'vite'),
				TMPDIR: join(this.dataDir, 'tmp'),
				NODE_OPTIONS: `--max-old-space-size=${this.buildHeapMb}`,
				NODE_ENV: 'production'
			};
			const kit = join(this.coreRoot, 'node_modules', '@sveltejs', 'kit', 'svelte-kit.js');
			const vite = join(this.coreRoot, 'node_modules', 'vite', 'bin', 'vite.js');
			await this.run(process.execPath, [kit, 'sync'], { cwd: this.coreRoot, env: buildEnv, write });
			await this.run(process.execPath, [vite, 'build'], {
				cwd: this.coreRoot,
				env: buildEnv,
				write
			});

			step('Probelauf');
			this.status({ state: 'verifying' });
			const report = await this.verify(genId, write);
			for (const id of Object.keys(request.modules ?? {})) {
				const broken = report.broken.find((b) => b.id === id);
				if (broken) throw new Error(`Modul ${id} ist defekt: ${broken.reason}`);
				if (!report.modules.some((m) => m.id === id)) throw new Error(`Modul ${id} fehlt im Build`);
			}

			writeJson(join(genDir, 'atrium-modules.lock.json'), lock);
			writeJson(join(genDir, 'BUILD_INFO.json'), {
				generation: genId,
				core: this.corePkg.version,
				planId,
				createdAt: new Date().toISOString(),
				modules: Object.fromEntries(report.modules.map((m) => [m.id, m.version]))
			});

			step('Neustart');
			this.status({ state: 'restarting' });
			this.setState({ current: genId, previous: prev.current ?? null });
			await this.stopChild();
			this.startChild(genId);
			if (!(await this.waitHealthy())) {
				write('Health-Prüfung fehlgeschlagen – zurück zur vorigen Generation');
				this.setState(prev);
				await this.stopChild();
				this.startChild(prev.current);
				await this.waitHealthy();
				throw new Error('Die neue Version startet nicht – vorige Version wieder aktiv');
			}
			this.finish(planId, genId, 'done', 'Installiert und neu gestartet', tail);
			this.cleanup();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			write(`FEHLER: ${message}`);
			this.finish(planId, genId, 'failed', message, tail);
			if (this.state().current !== genId) rmSync(genDir, { recursive: true, force: true });
		}
	}

	finish(planId, genId, status, message, tail) {
		const finishedAt = new Date().toISOString();
		this.status({
			state: status,
			planId,
			generation: genId,
			step: null,
			message,
			finishedAt,
			logTail: tail
		});
		if (planId) {
			writeJson(join(this.dataDir, 'results', `${planId}.json`), {
				planId,
				status,
				generation: status === 'done' ? genId : null,
				message,
				finishedAt
			});
			rmSync(join(this.dataDir, 'staging', planId), { recursive: true, force: true });
		}
		this.log(`${planId ?? 'Neubau'}: ${status} – ${message}`);
	}

	/** Alte Generationen löschen (laufende und vorige bleiben) */
	cleanup() {
		const { current, previous } = this.state();
		for (const id of readdirSync(join(this.dataDir, 'gen'))) {
			if (id !== current && id !== previous) {
				rmSync(this.genDir(id), { recursive: true, force: true });
			}
		}
	}

	/** Befehl ausführen, Ausgabe ins Protokoll; Exit-Code ≠ 0 → Fehler */
	run(cmd, args, { cwd, env = this.env, write, shell = false }) {
		return new Promise((ok, fail) => {
			write(`$ ${[cmd, ...args].map((a) => relative(this.coreRoot, a) || a).join(' ')}`);
			const p = spawn(cmd, args, { cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe'] });
			p.stdout.on('data', (d) => write(String(d).trimEnd()));
			p.stderr.on('data', (d) => write(String(d).trimEnd()));
			p.on('error', fail);
			p.on('exit', (code) =>
				code === 0
					? ok()
					: fail(new Error(`${relative(this.coreRoot, cmd) || cmd} endete mit Code ${code}`))
			);
		});
	}

	/** Probelauf der neuen Generation: Module laden, Bericht lesen */
	verify(genId, write) {
		const rt = this.runtime(genId);
		return new Promise((ok, fail) => {
			let out = '';
			const p = spawn(process.execPath, [join(rt.build, 'index.js')], {
				cwd: this.coreRoot,
				env: this.childEnv(rt, { ATRIUM_VERIFY_ONLY: '1', PORT: '0', HOST: '127.0.0.1' }),
				stdio: ['ignore', 'pipe', 'pipe']
			});
			const timer = setTimeout(() => p.kill('SIGKILL'), 60_000);
			p.stdout.on('data', (d) => (out += String(d)));
			p.stderr.on('data', (d) => write(String(d).trimEnd()));
			p.on('exit', () => {
				clearTimeout(timer);
				const line = out.split(/\r?\n/).find((l) => l.startsWith(VERIFY_PREFIX));
				if (!line) return fail(new Error('Probelauf lieferte keinen Bericht'));
				const report = JSON.parse(line.slice(VERIFY_PREFIX.length));
				if (report.error) return fail(new Error(`Probelauf: ${report.error}`));
				write(`Probelauf: ${report.modules.length} Module, ${report.broken.length} defekt`);
				ok(report);
			});
		});
	}
}
