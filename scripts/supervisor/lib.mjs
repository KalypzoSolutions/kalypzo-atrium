/**
 * Supervisor für Kalypzo Atrium: startet die gebaute App als Kindprozess, kompiliert im Panel installierte Module
 * einzeln (`scripts/module-compiler`) und startet die App danach kurz neu – **ohne** App-Neubau
 * (Umbau „Module ohne App-Neubau“, Phase 4; davor: Generationen mit vollem `vite build`).
 *
 * Datenverzeichnis (`dataDir`, im Container ein Volume):
 *   bundles/                           vorkompilierte Module, aktive Liste, Lock-Datei (`bundles.mjs`)
 *   state.json                         Seed-Kennung; `current` nur noch von alten Generationen (Übergang)
 *   status.json                        Stand für das Panel (state, step, message, logTail …)
 *   staging/<planId>/request.json + modules/<id>/…   Auftrag der App
 *   results/<planId>.json              Ergebnis (liest die App beim Start)
 *   logs/<planId|zeit>.log             Protokoll eines Laufs
 *   gen/<id>/…                         alte Generationen – werden beim ersten Start übernommen und gelöscht
 *
 * Die App läuft immer aus dem mitgelieferten Build (`baseBuildDir`); installierte Module kommen als Bundles dazu.
 * Ablauf eines Auftrags: Module zusammenstellen → je geändertem Modul kompilieren → Probelauf (`ATRIUM_VERIFY_ONLY=1`
 * mit der neuen Liste) → Tausch der aktiven Liste → Neustart → Health-Prüfung → sonst vorige Liste zurück.
 * Nach einem Core-Update (andere ABI) kompiliert der Supervisor die betroffenen Module aus ihrer gespeicherten Quelle neu.
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
	statSync
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	ACTIVE_FILE,
	FAILURES_FILE,
	LOCK_FILE,
	NEXT_FILE,
	PREV_FILE,
	planCompile,
	readActive,
	readLock,
	staleModules,
	unreferencedBuilds,
	writeJsonAtomic
} from './bundles.mjs';
import { downloadZipball, extractSeedModules, readSeed, writeModuleFiles } from './seed.mjs';

export const VERIFY_PREFIX = 'ATRIUM_VERIFY ';
const COMPILE_PREFIX = 'ATRIUM_COMPILE ';
const PLAN_RE = /^[A-Za-z0-9_-]{8,80}$/;
const STOP_TIMEOUT_MS = 30_000;
const COMPILE_TIMEOUT_MS = 10 * 60_000;
const LOG_TAIL = 40;

/** Inhaltshash eines Ordners – gleiche Regel wie `contentHash` in `core/modules/install/archive.ts` */
export function contentHashOfDir(dir) {
	const files = [];
	const walk = (d) => {
		for (const name of readdirSync(d)) {
			// gleiche Regel wie das Archiv (archive.ts): versteckte Einträge und node_modules zählen nicht
			if (name.startsWith('.') || name === 'node_modules') continue;
			const p = join(d, name);
			if (statSync(p).isDirectory()) walk(p);
			else files.push(relative(dir, p).split('\\').join('/'));
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

function readJson(file, fallback = null) {
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return fallback;
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Kopierfilter: nie `node_modules` mitnehmen */
function cpFilter() {
	return (src) => !src.split(/[\\/]/).includes('node_modules');
}

const CRASH_WINDOW_MS = 60_000;
const CRASH_LIMIT = 5;
const RESTART_DELAY_MS = 2000;
const BUSY_RESTART_MAX_MS = 30_000;

/**
 * Was tun nach einem Absturz der App? `crashes` = Abstürze im Zeitfenster (inkl. dem aktuellen).
 * - Bis `CRASH_LIMIT`: nach kurzer Pause neu starten.
 * - Läuft ein Auftrag oder wartet einer (`busy`, etwa das Neukompilieren nach einem Core-Update), kein Rückfall und
 *   kein Beenden: Neustart mit wachsender Pause, damit das Protokoll nicht vollläuft.
 * - Sonst Rückfall: `current` (es sind Module aktiv) → vorige Liste (`previous`) bzw. ganz ohne installierte Module
 *   (`previous` = null); stürzt auch die App ohne installierte Module ab, beendet sich der Supervisor (Container-Neustart).
 * @returns {{ action: 'restart' | 'fallback' | 'exit', delayMs: number, waiting?: boolean }}
 */
export function crashDecision({ crashes, current, previous, busy }) {
	if (crashes <= CRASH_LIMIT) return { action: 'restart', delayMs: RESTART_DELAY_MS };
	if (busy) {
		const delayMs = Math.min(
			BUSY_RESTART_MAX_MS,
			RESTART_DELAY_MS * 2 ** Math.min(4, crashes - CRASH_LIMIT)
		);
		return { action: 'restart', delayMs, waiting: true };
	}
	if (current && previous !== undefined) return { action: 'fallback', delayMs: RESTART_DELAY_MS };
	return { action: 'exit', delayMs: 0 };
}

export class Supervisor {
	/**
	 * @param {{
	 *   coreRoot: string,
	 *   dataDir: string,
	 *   env?: Record<string, string | undefined>,
	 *   baseModulesDir?: string,
	 *   baseBuildDir?: string,
	 *   healthTimeoutMs?: number,
	 *   log?: (msg: string) => void,
	 *   abi?: string
	 * }} opts
	 */
	constructor(opts) {
		this.coreRoot = resolve(opts.coreRoot);
		this.dataDir = resolve(opts.dataDir);
		this.env = { ...process.env, ...(opts.env ?? {}) };
		this.baseModulesDir = resolve(opts.baseModulesDir ?? join(this.coreRoot, 'modules'));
		this.baseBuildDir = resolve(opts.baseBuildDir ?? join(this.coreRoot, 'build'));
		this.healthTimeoutMs = opts.healthTimeoutMs ?? 120_000;
		this.log = opts.log ?? ((m) => console.log(`[supervisor] ${m}`));
		/** GitHub-Archiv laden (für Tests ersetzbar) */
		this.download = opts.download ?? downloadZipball;
		this.corePkg = readJson(join(this.coreRoot, 'package.json'), {});
		this.compileScript = join(this.coreRoot, 'scripts', 'module-compiler', 'compile.mjs');
		/** ABI-Kennung des Core (aus `tools/host-abi.js`, beim ersten Bedarf berechnet) */
		this._abi = opts.abi ?? null;
		/** @type {import('node:child_process').ChildProcess | null} */
		this.child = null;
		this.expectedExit = false;
		this.crashes = [];
		this.queue = Promise.resolve();
		/** Laufende + wartende Aufträge: solange > 0 kein Rückfall/Beenden bei Abstürzen */
		this.pending = 0;
		this.stopping = false;
		// tmp/vite-temp: Ziel des Links node_modules/.vite-temp im Image (Dockerfile)
		for (const d of ['bundles', 'staging', 'results', 'logs', 'cache', 'tmp', 'tmp/vite-temp']) {
			mkdirSync(join(this.dataDir, d), { recursive: true });
		}
	}

	get port() {
		return Number(this.env.PORT ?? 3000);
	}

	get bundlesDir() {
		return join(this.dataDir, 'bundles');
	}

	async abi() {
		if (!this._abi) {
			const m = await import(pathToFileURL(join(this.coreRoot, 'tools', 'host-abi.js')).href);
			this._abi = m.hostAbiHash(this.coreRoot);
		}
		return this._abi;
	}

	// --- Zustand ---------------------------------------------------------------------------------

	state() {
		return readJson(join(this.dataDir, 'state.json'), {});
	}

	/** Zustand ändern (zusammenführen) */
	setState(s) {
		writeJsonAtomic(join(this.dataDir, 'state.json'), { ...this.state(), ...s });
	}

	status(patch) {
		const file = join(this.dataDir, 'status.json');
		const next = { ...readJson(file, {}), ...patch };
		writeJsonAtomic(file, next);
		return next;
	}

	/** Kennung des laufenden Stands für das Panel (Anzahl aktiver Bundles) */
	runningLabel() {
		const n = Object.keys(readActive(this.bundlesDir).modules).length;
		return `bundles:${n}`;
	}

	// --- Kindprozess -----------------------------------------------------------------------------

	childEnv(extra = {}) {
		return {
			...this.env,
			ATRIUM_SUPERVISOR: '1',
			ATRIUM_DATA_DIR: this.dataDir,
			ATRIUM_GENERATION: 'bundles',
			ATRIUM_MODULES_DIR: this.baseModulesDir,
			ATRIUM_MODULE_INSTALL: this.env.ATRIUM_MODULE_INSTALL ?? 'supervisor',
			...extra
		};
	}

	startChild() {
		const entry = join(this.baseBuildDir, 'index.js');
		if (!existsSync(entry)) throw new Error(`Kein Build gefunden: ${entry}`);
		this.log(`Starte App (${this.runningLabel()})`);
		this.expectedExit = false;
		const child = spawn(process.execPath, [entry], {
			cwd: this.coreRoot,
			env: this.childEnv(),
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
		this.crashes = [...this.crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
		const active = join(this.bundlesDir, ACTIVE_FILE);
		const prev = join(this.bundlesDir, PREV_FILE);
		const hasModules = Object.keys(readActive(this.bundlesDir).modules).length > 0;
		const decision = crashDecision({
			crashes: this.crashes.length,
			current: hasModules ? 'active' : null,
			previous: existsSync(prev) ? 'prev' : null,
			busy: this.pending > 0
		});
		if (decision.action === 'fallback') {
			if (existsSync(prev)) {
				this.log('App stürzt wiederholt ab – zurück zur vorigen Modul-Liste');
				renameSync(active, join(this.bundlesDir, 'active.failed.json'));
				renameSync(prev, active);
			} else {
				this.log(
					'App stürzt wiederholt ab – Start ohne installierte Module (active.disabled.json)'
				);
				renameSync(active, join(this.bundlesDir, 'active.disabled.json'));
			}
			this.crashes = [];
		} else if (decision.action === 'exit') {
			this.log('App stürzt auch ohne installierte Module wiederholt ab – Supervisor beendet sich');
			process.exit(1);
		} else if (decision.waiting) {
			this.log(
				`App stürzt ab, ein Auftrag läuft oder wartet – Neustart in ${decision.delayMs / 1000} s (kein Rückfall, bis er fertig ist)`
			);
		}
		setTimeout(() => {
			if (!this.child && !this.stopping) this.startChild();
		}, decision.delayMs).unref();
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
			this.log(`Ungültiger Auftrag ignoriert: ${planId.slice(0, 80)}`);
			return;
		}
		this.status({ state: 'queued', planId, step: 'Wartet', message: null, finishedAt: null });
		this.enqueue(() => this.compile(planId));
	}

	enqueue(fn) {
		this.pending++;
		this.queue = this.queue
			.then(fn)
			.catch((e) => this.log(`Fehler: ${e?.message ?? e}`))
			.finally(() => this.pending--);
		return this.queue;
	}

	// --- Start/Stopp -----------------------------------------------------------------------------

	async start() {
		const legacy = this.state().current;
		const hasActive = existsSync(join(this.bundlesDir, ACTIVE_FILE));
		this.status({ state: 'idle', running: this.runningLabel(), step: null });
		this.startChild();
		// Übergang: Module der alten Generation einmal übernehmen (kompilieren), danach Generationen löschen
		if (legacy && !hasActive) this.enqueue(() => this.migrateLegacy(legacy));
		// Neuer Core (andere ABI): betroffene Module aus ihrer gespeicherten Quelle neu kompilieren
		const stale = staleModules(this.bundlesDir, readActive(this.bundlesDir), await this.abi());
		if (stale.length) {
			this.log(`Neu zu kompilieren (Core geändert): ${stale.join(', ')}`);
			this.enqueue(() => this.compile(null, { recompile: stale }));
		}
		// Frisches Deployment: Module aus der Seed-Liste holen und kompilieren (einmal je Seed-Inhalt)
		if (!legacy && !Object.keys(readActive(this.bundlesDir).modules).length) {
			let seed = null;
			try {
				seed = readSeed(this.coreRoot, this.env);
			} catch (e) {
				this.log(`Seed ungültig: ${e?.message ?? e}`);
			}
			if (seed && this.state().seed !== seed.hash) this.enqueue(() => this.applySeed(seed));
		}
	}

	/**
	 * Alte Generation (vor Phase 4) übernehmen: deren Module als Auftrag einspielen und kompilieren. Erfolgreich →
	 * Generationen löschen; Module, die sich nicht kompilieren lassen, fehlen danach (Anzeige „Nicht installiert“,
	 * Wiederherstellung über das Panel bzw. nach einem Modul-Update).
	 */
	async migrateLegacy(genId) {
		const genDir = join(this.dataDir, 'gen', String(genId));
		const lock = readJson(join(genDir, 'atrium-modules.lock.json'), { modules: {} });
		const modulesDir = join(genDir, 'modules');
		const planId = `legacy${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
		const root = join(this.dataDir, 'staging', planId);
		const request = {
			planId,
			requestedBy: 'legacy',
			requestedAt: new Date().toISOString(),
			modules: {},
			remove: []
		};
		for (const id of moduleFolders(modulesDir)) {
			const entry = lock.modules?.[id];
			if (!entry || entry.sourceType === 'builtin') continue;
			cpSync(join(modulesDir, id), join(root, 'modules', id), {
				recursive: true,
				filter: cpFilter()
			});
			request.modules[id] = { ...entry, contentHash: contentHashOfDir(join(root, 'modules', id)) };
		}
		mkdirSync(root, { recursive: true });
		writeJsonAtomic(join(root, 'request.json'), request);
		this.log(
			`Übernehme Generation ${genId}: ${Object.keys(request.modules).join(', ') || 'keine Module'}`
		);
		await this.compile(planId, { partial: true });
		this.setState({ current: null, previous: null, migratedFrom: genId });
		rmSync(join(this.dataDir, 'gen'), { recursive: true, force: true });
	}

	/** Module der Seed-Liste von GitHub holen (fester Commit), als Auftrag ablegen und kompilieren */
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
			writeJsonAtomic(join(root, 'request.json'), request);
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			this.finish(planId, 'failed', message, [message]);
			return;
		}
		await this.compile(planId);
		if (Object.keys(readActive(this.bundlesDir).modules).length) this.setState({ seed: seed.hash });
	}

	async stop() {
		this.stopping = true;
		await this.stopChild();
	}

	// --- Kompilieren und Tauschen ----------------------------------------------------------------

	/**
	 * Auftrag ausführen. `planId = null`: nur `opts.recompile` (nach Core-Update).
	 * `opts.partial`: Module, die nicht kompilieren, auslassen statt den ganzen Auftrag abzubrechen (Übergang).
	 */
	async compile(planId, opts = {}) {
		const startedAt = new Date().toISOString();
		const logId = planId ?? `recompile-${Date.now().toString(36)}`;
		const logFile = join(this.dataDir, 'logs', `${logId}.log`);
		const tail = [];
		const write = (line) => {
			appendFileSync(logFile, `${line}\n`);
			for (const l of String(line).split(/\r?\n/)) if (l.trim()) tail.push(l.slice(0, 300));
			while (tail.length > LOG_TAIL) tail.shift();
		};
		const step = (name) => {
			write(`== ${name}`);
			this.log(`${planId ?? 'Neukompilieren'}: ${name}`);
			this.status({ state: 'building', planId, step: name, startedAt, logTail: tail });
		};
		const bundles = this.bundlesDir;
		const abi = await this.abi();
		try {
			const stagingDir = planId ? join(this.dataDir, 'staging', planId) : null;
			const request = stagingDir
				? readJson(join(stagingDir, 'request.json'))
				: { modules: {}, remove: [] };
			if (!request) throw new Error('Auftrag nicht lesbar');

			step('Module zusammenstellen');
			const active = readActive(bundles);
			const lock = readLock(bundles, this.corePkg.version);
			const plan = planCompile({
				bundlesDir: bundles,
				active,
				lock,
				request,
				recompile: opts.recompile ?? [],
				abi,
				stagingDir
			});
			for (const job of plan.jobs.filter((j) => j.requested)) {
				const actual = contentHashOfDir(job.source);
				if (actual !== request.modules[job.id].contentHash)
					throw new Error(`Inhalt von ${job.id} weicht von der Vorschau ab`);
			}

			step('Module kompilieren');
			const failures = readJson(join(bundles, FAILURES_FILE), {});
			const failuresBefore = JSON.stringify(failures);
			/** @type {string[]} */
			const failed = [];
			for (const job of plan.jobs) {
				delete failures[job.id];
				if (job.reuse) {
					write(`${job.id}: unverändert (${job.build})`);
					continue;
				}
				const r = await this.compileOne(job, write);
				if (r.ok) continue;
				failures[job.id] = { kind: r.kind, message: r.message, package: r.package ?? null };
				failed.push(job.id);
				if (job.requested && !opts.partial) throw new Error(`Modul ${job.id}: ${r.message}`);
				// Nicht kompilierbar: alter Stand bleibt (zeigt „für andere Core-Version“ + Grund) bzw. fällt weg
				if (active.modules[job.id]) {
					plan.next.modules[job.id] = active.modules[job.id];
					plan.nextLock.modules[job.id] = lock.modules[job.id];
				} else {
					delete plan.next.modules[job.id];
					delete plan.nextLock.modules[job.id];
				}
			}

			const changed = JSON.stringify(plan.next) !== JSON.stringify(active);
			writeJsonAtomic(join(bundles, FAILURES_FILE), failures);
			if (!changed) {
				writeJsonAtomic(join(bundles, LOCK_FILE), plan.nextLock);
				if (JSON.stringify(failures) !== failuresBefore && this.child) {
					// Die App liest `failures.json` nur beim Start: neu starten, damit „wird vorbereitet“ zum Fehlergrund wird
					step('Neustart');
					await this.stopChild();
					this.startChild();
				}
				this.finish(
					planId,
					failed.length ? 'failed' : 'done',
					failed.length ? `Nicht kompilierbar: ${failed.join(', ')}` : 'Keine Änderung',
					tail
				);
				return;
			}

			step('Probelauf');
			this.status({ state: 'verifying' });
			writeJsonAtomic(join(bundles, NEXT_FILE), plan.next);
			const report = await this.verify(write, NEXT_FILE);
			for (const job of plan.jobs.filter((j) => j.requested && plan.next.modules[j.id])) {
				const broken = report.broken.find((b) => b.id === job.id);
				if (broken) throw new Error(`Modul ${job.id} ist defekt: ${broken.reason}`);
				if (!report.modules.some((m) => m.id === job.id))
					throw new Error(`Modul ${job.id} fehlt nach dem Kompilieren`);
			}

			step('Neustart');
			this.status({ state: 'restarting' });
			const activeFile = join(bundles, ACTIVE_FILE);
			const prevFile = join(bundles, PREV_FILE);
			if (existsSync(activeFile)) cpSync(activeFile, prevFile);
			renameSync(join(bundles, NEXT_FILE), activeFile);
			writeJsonAtomic(join(bundles, LOCK_FILE), plan.nextLock);
			await this.stopChild();
			this.startChild();
			if (!(await this.waitHealthy())) {
				write('Health-Prüfung fehlgeschlagen – zurück zur vorigen Modul-Liste');
				if (existsSync(prevFile)) cpSync(prevFile, activeFile);
				else rmSync(activeFile, { force: true });
				writeJsonAtomic(join(bundles, LOCK_FILE), lock);
				await this.stopChild();
				this.startChild();
				await this.waitHealthy();
				throw new Error('Die neue Version startet nicht – vorige Version wieder aktiv');
			}
			this.finish(
				planId,
				'done',
				planId ? 'Installiert und neu gestartet' : 'Neu kompiliert und neu gestartet',
				tail
			);
			this.cleanup();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			write(`FEHLER: ${message}`);
			rmSync(join(bundles, NEXT_FILE), { force: true });
			this.finish(planId, 'failed', message, tail);
		}
	}

	/**
	 * Ein Modul in den Bundle-Ordner kompilieren (eigener Prozess, `scripts/module-compiler/compile.mjs`).
	 * Erst in einen temporären Ordner, dann Quelle nach `src/` dazulegen und umbenennen – ein halbfertiges Bundle wird
	 * nie sichtbar.
	 */
	async compileOne(job, write) {
		const target = join(this.bundlesDir, job.dir);
		const tmp = `${target}.tmp-${randomBytes(3).toString('hex')}`;
		write(`${job.id}: kompilieren → ${job.build}`);
		const started = Date.now();
		const result = await new Promise((ok) => {
			let out = '';
			const p = spawn(process.execPath, [this.compileScript, job.source, tmp, `--id=${job.id}`], {
				cwd: this.coreRoot,
				env: { ...this.env, NODE_ENV: 'production', TMPDIR: join(this.dataDir, 'tmp') },
				stdio: ['ignore', 'pipe', 'pipe']
			});
			const timer = setTimeout(() => p.kill('SIGKILL'), COMPILE_TIMEOUT_MS);
			p.stdout.on('data', (d) => (out += String(d)));
			p.stderr.on('data', (d) => write(String(d).trimEnd()));
			p.on('error', (e) => ok({ ok: false, kind: 'build', message: e.message }));
			p.on('exit', () => {
				clearTimeout(timer);
				const line = out.split(/\r?\n/).find((l) => l.startsWith(COMPILE_PREFIX));
				if (!line)
					return ok({ ok: false, kind: 'build', message: 'Compiler lieferte kein Ergebnis' });
				const r = JSON.parse(line.slice(COMPILE_PREFIX.length));
				ok(r.ok ? { ok: true } : { ok: false, ...r.error });
			});
		});
		if (!result.ok) {
			write(`${job.id}: FEHLER ${result.message}`);
			rmSync(tmp, { recursive: true, force: true });
			return result;
		}
		cpSync(job.source, join(tmp, 'src'), { recursive: true, filter: cpFilter() });
		rmSync(target, { recursive: true, force: true });
		renameSync(tmp, target);
		write(`${job.id}: fertig in ${((Date.now() - started) / 1000).toFixed(1)} s`);
		return { ok: true };
	}

	finish(planId, status, message, tail) {
		const finishedAt = new Date().toISOString();
		this.status({
			state: status,
			planId,
			generation: null,
			running: this.runningLabel(),
			step: null,
			message,
			finishedAt,
			logTail: tail
		});
		if (planId) {
			writeJsonAtomic(join(this.dataDir, 'results', `${planId}.json`), {
				planId,
				status,
				generation: null,
				message,
				finishedAt
			});
			rmSync(join(this.dataDir, 'staging', planId), { recursive: true, force: true });
		}
		this.log(`${planId ?? 'Neukompilieren'}: ${status} – ${message}`);
	}

	/** Build-Ordner (auch liegengebliebene `.tmp-…`) löschen, die weder aktiv noch im vorigen Stand stehen */
	cleanup() {
		const keep = [readActive(this.bundlesDir), readActive(this.bundlesDir, PREV_FILE)];
		for (const dir of unreferencedBuilds(this.bundlesDir, keep)) {
			// nie einen leeren Pfad löschen (rmSync('') leert unter Bun das Arbeitsverzeichnis)
			if (!/^[a-z][a-z0-9-]*\/[^/]+$/.test(dir)) continue;
			rmSync(join(this.bundlesDir, dir), { recursive: true, force: true });
		}
	}

	/** Probelauf: App mit der Kandidaten-Liste laden, Bericht lesen */
	verify(write, activeFile = ACTIVE_FILE) {
		return new Promise((ok, fail) => {
			let out = '';
			const p = spawn(process.execPath, [join(this.baseBuildDir, 'index.js')], {
				cwd: this.coreRoot,
				env: this.childEnv({
					ATRIUM_VERIFY_ONLY: '1',
					ATRIUM_BUNDLES_ACTIVE: activeFile,
					PORT: '0',
					HOST: '127.0.0.1'
				}),
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
