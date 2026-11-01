/**
 * Modul-Installation im Panel (Kalypzo Atrium, Phase 5):
 * 1. `inspectSource` – GitHub-Link oder ZIP lesen, Module der Quelle auflisten (Sitzung mit Token, 15 min),
 * 2. `previewInstall` – Auswahl auflösen (Abhängigkeiten), jedes Modul analysieren (Rechte, Migrationen, npm, Hinweise),
 * 3. `confirmInstall` – nach erneuter Anmeldung ausführen. Phase 5: Modus `copy` (Dateien direkt ins
 *    Modulverzeichnis, für `vite dev`); `supervisor` (Neubau + Neustart) folgt in Phase 6.
 * Nur Administrator*innen mit `core.modules.install`, nur per Sitzung (kein API-Key). Modulcode läuft danach mit
 * vollen Rechten im Server – keine Sandbox.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { desc } from 'drizzle-orm';
import { localized, t } from '$lib/i18n';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../../audit/service';
import { getDb, schema } from '../../database/client';
import { env } from '../../env';
import { errors } from '../../errors';
import { isAdministrator, requirePermission } from '../../permissions/service';
import { getSetting } from '../../settings/service';
import {
	acquireMaintenanceLock,
	releaseMaintenanceLock,
	verifyReauth
} from '../../system/maintenance';
import { formatModuleSource, parseModuleSource, type ModuleSource } from '../package/schema';
import { getDefinition } from '../registry';
import { analyzeModule, type ModuleAnalysis } from './analyze';
import { readModuleArchive, type ArchiveFiles } from './archive';
import { discoverModules, type DiscoveredRepo } from './discover';
import { downloadGithubArchive, resolveGithubSource } from './github';
import { resolvePlan, type Candidate, type CandidateOrigin, type ResolvedPlan } from './resolve';
import {
	cacheUploadedSource,
	readSupervisorStatus,
	runtimeModulesDir,
	requestSupervisorBuild,
	supervisorAvailable,
	type BuildRequest
} from './supervisor-link';

export const INSTALL_PERMISSION = 'core.modules.install';
const SESSION_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 8;

export type InstallMode = 'off' | 'copy' | 'supervisor';

export function installMode(): InstallMode {
	const e = env();
	return e.ATRIUM_MODULE_INSTALL ?? (e.NODE_ENV === 'development' ? 'copy' : 'off');
}

export interface InstallStatus {
	mode: InstallMode;
	/** Ausführen möglich (Vorschau geht immer) */
	available: boolean;
	reason: string | null;
}

export function installStatus(): InstallStatus {
	const mode = installMode();
	if (mode === 'off') {
		return {
			mode,
			available: false,
			reason: t('install.service.off')
		};
	}
	if (mode === 'supervisor') {
		if (!supervisorAvailable()) {
			return {
				mode,
				available: false,
				reason: t('install.service.noSupervisor')
			};
		}
		const busy = readSupervisorStatus().state;
		if (busy === 'queued' || busy === 'building' || busy === 'verifying' || busy === 'restarting') {
			return { mode, available: false, reason: t('install.service.busy') };
		}
	}
	return { mode, available: true, reason: null };
}

export { runtimeModulesDir } from './supervisor-link';

// --- Rechte -------------------------------------------------------------------------------------

export async function assertInstaller(ctx: RequestContext): Promise<string> {
	await requirePermission(ctx, INSTALL_PERMISSION);
	if (ctx.actor.type !== 'user' || !ctx.userId) {
		throw errors.forbidden(t('install.service.sessionOnly'));
	}
	if (!isAdministrator(ctx)) {
		throw errors.forbidden(t('install.service.adminOnly'));
	}
	return ctx.userId;
}

// --- Sitzungen (Quelle, Plan) -------------------------------------------------------------------

interface SourceSession {
	kind: 'source';
	userId: string;
	expires: number;
	label: string;
	base:
		| { type: 'github'; owner: string; repo: string; ref: string; sha: string; path: string }
		| {
				type: 'upload';
				fileName: string;
				zipSha256: string;
				path: string;
		  };
	files: ArchiveFiles;
	repo: DiscoveredRepo;
}

interface PlanSession {
	kind: 'plan';
	userId: string;
	expires: number;
	plan: ResolvedPlan;
	analyses: ModuleAnalysis[];
	blockers: string[];
}

const sessions = new Map<string, SourceSession | PlanSession>();

function store(s: SourceSession | PlanSession): string {
	const now = Date.now();
	for (const [k, v] of sessions) if (v.expires < now) sessions.delete(k);
	while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
	const token = randomBytes(24).toString('base64url');
	sessions.set(token, s);
	return token;
}

function take<K extends 'source' | 'plan'>(
	token: string,
	kind: K,
	userId: string
): Extract<SourceSession | PlanSession, { kind: K }> {
	const s = typeof token === 'string' ? sessions.get(token) : undefined;
	if (!s || s.kind !== kind || s.userId !== userId || s.expires < Date.now()) {
		throw errors.notFound(t('install.service.expired'));
	}
	return s as Extract<SourceSession | PlanSession, { kind: K }>;
}

/** Nur für Tests */
export function resetInstallSessionsForTests(): void {
	sessions.clear();
	archiveCache.clear();
}

// --- Quelle -------------------------------------------------------------------------------------

/** GitHub-Angabe lesen; bei `…/tree/<ref>/<rest>` bleibt der Rest zur Auflösung offen (Ref kann `/` enthalten) */
export function parseInstallInput(raw: string): { source: ModuleSource; pathAfterRef: string[] } {
	const value = raw.trim();
	const source = parseModuleSource(/^[\w.-]+\/[\w.-]+$/.test(value) ? `github:${value}` : value);
	if (!source) {
		throw errors.validation([
			{
				path: ['url'],
				message: t('install.service.invalidUrl')
			}
		]);
	}
	const tree = /^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\/(.+)$/.exec(value.replace(/\/+$/, ''));
	if (tree) {
		const parts = tree[1]!.split('/');
		return { source: { ...source, ref: parts[0]!, path: '' }, pathAfterRef: parts.slice(1) };
	}
	return { source, pathAfterRef: [] };
}

async function allowedSources(): Promise<string[]> {
	return String((await getSetting('core.modules.allowedSources')) ?? '')
		.split(/\r?\n/)
		.map((l) => l.trim().toLowerCase())
		.filter((l) => l && !l.startsWith('#'));
}

async function assertSourceAllowed(owner: string | null, repo: string | null): Promise<void> {
	const list = await allowedSources();
	if (!list.length) return;
	if (owner === null) {
		throw errors.forbidden(t('install.service.zipNotAllowed'));
	}
	const full = `${owner}/${repo}`.toLowerCase();
	if (!list.some((l) => l === full || l === `${owner.toLowerCase()}/*`)) {
		throw errors.forbidden(t('install.service.sourceNotAllowed', { source: `${owner}/${repo}` }));
	}
}

/** Archiv-Cache je Commit, damit Abhängigkeiten aus demselben Repository nicht doppelt geladen werden */
const archiveCache = new Map<string, { files: ArchiveFiles; at: number }>();

async function githubFiles(owner: string, repo: string, sha: string): Promise<ArchiveFiles> {
	const key = `${owner}/${repo}@${sha}`.toLowerCase();
	const hit = archiveCache.get(key);
	if (hit && Date.now() - hit.at < SESSION_MS) return hit.files;
	const files = readModuleArchive(await downloadGithubArchive(owner, repo, sha));
	archiveCache.set(key, { files, at: Date.now() });
	while (archiveCache.size > 4) archiveCache.delete(archiveCache.keys().next().value!);
	return files;
}

export interface SourceModuleInfo {
	id: string;
	name: string;
	description: string;
	version: string;
	installedVersion: string | null;
	dependencies: string[];
	optionalDependencies: string[];
}

export interface SourceInspection {
	token: string;
	/** Anzeige, z. B. `github:org/repo#main` oder Dateiname */
	label: string;
	commit: string | null;
	catalogName: string | null;
	modules: SourceModuleInfo[];
	problems: { dir: string; reason: string }[];
}

export async function inspectSource(
	ctx: RequestContext,
	input: { url: string } | { zip: Uint8Array; fileName: string }
): Promise<SourceInspection> {
	const userId = await assertInstaller(ctx);
	let session: Omit<SourceSession, 'repo'>;
	if ('url' in input) {
		const { source, pathAfterRef } = parseInstallInput(input.url);
		await assertSourceAllowed(source.owner, source.repo);
		const r = await resolveGithubSource(source, pathAfterRef);
		const files = await githubFiles(r.owner, r.repo, r.sha);
		session = {
			kind: 'source',
			userId,
			expires: Date.now() + SESSION_MS,
			label: formatModuleSource({
				type: 'github',
				owner: r.owner,
				repo: r.repo,
				path: r.path,
				ref: r.ref
			}),
			base: { type: 'github', ...r },
			files
		};
	} else {
		await assertSourceAllowed(null, null);
		const files = readModuleArchive(input.zip);
		const zipSha256 = createHash('sha256').update(input.zip).digest('hex');
		// Unter dem Supervisor aufheben: so lässt sich das Modul später ohne erneuten Upload wiederherstellen
		await cacheUploadedSource(zipSha256, input.zip).catch((e) =>
			console.error('[modules] ZIP konnte nicht zwischengespeichert werden:', e)
		);
		const name = String(input.fileName || 'modul.zip').slice(0, 120);
		session = {
			kind: 'source',
			userId,
			expires: Date.now() + SESSION_MS,
			label: name,
			base: {
				type: 'upload',
				fileName: name,
				zipSha256,
				path: ''
			},
			files
		};
	}
	const repo = discoverModules(session.files, session.base.path);
	const token = store({ ...session, repo });
	return {
		token,
		label: session.label,
		commit: session.base.type === 'github' ? session.base.sha : null,
		catalogName: repo.catalogName,
		modules: repo.modules.map((m) => ({
			id: m.id,
			name: localized(m.pkg.name),
			description: localized(m.pkg.description),
			version: m.pkg.version,
			installedVersion: getDefinition(m.id)?.manifest.version ?? null,
			dependencies: Object.keys(m.pkg.dependencies),
			optionalDependencies: Object.keys(m.pkg.optionalDependencies)
		})),
		problems: repo.problems
	};
}

// --- Vorschau -----------------------------------------------------------------------------------

export interface PreviewEntry extends ModuleAnalysis {
	reason: 'selected' | 'dependency';
	requiredBy: string[];
	/** Herkunft zur Anzeige, z. B. `github:org/repo/modules/x#main` */
	origin: string;
	commit: string | null;
	/** Link auf den Stand bei GitHub */
	commitUrl: string | null;
}

export interface InstallPreview {
	token: string;
	entries: PreviewEntry[];
	satisfied: ResolvedPlan['satisfied'];
	recommended: ResolvedPlan['recommended'];
	/** Alles, was die Installation sperrt (Auflösung + Analyse) */
	blockers: string[];
	status: InstallStatus;
}

function originOf(base: SourceSession['base'], dir: string): CandidateOrigin {
	return base.type === 'github'
		? {
				type: 'github',
				owner: base.owner,
				repo: base.repo,
				ref: base.ref,
				sha: base.sha,
				path: dir
			}
		: { type: 'upload', fileName: base.fileName, zipSha256: base.zipSha256, path: dir };
}

function originLabel(o: CandidateOrigin): {
	origin: string;
	commit: string | null;
	commitUrl: string | null;
} {
	if (o.type === 'upload')
		return {
			origin: `ZIP ${o.fileName}${o.path ? ` (${o.path})` : ''}`,
			commit: null,
			commitUrl: null
		};
	return {
		origin: formatModuleSource({
			type: 'github',
			owner: o.owner,
			repo: o.repo,
			path: o.path,
			ref: o.ref
		}),
		commit: o.sha,
		commitUrl: `https://github.com/${o.owner}/${o.repo}/tree/${o.sha}${o.path ? `/${o.path}` : ''}`
	};
}

export async function previewInstall(
	ctx: RequestContext,
	input: { sourceToken: string; selected: string[] }
): Promise<InstallPreview> {
	const userId = await assertInstaller(ctx);
	const src = take(input.sourceToken, 'source', userId);
	const selected = [...new Set(input.selected)].filter(Boolean);
	if (!selected.length) {
		throw errors.validation([{ path: ['selected'], message: t('install.service.selectOne') }]);
	}
	const repo: Candidate[] = src.repo.modules.map((m) => ({
		mod: m,
		origin: originOf(src.base, m.dir)
	}));
	const plan = await resolvePlan(selected, repo, async (sourceText, wantedId) => {
		const { source, pathAfterRef } = parseInstallInput(sourceText);
		await assertSourceAllowed(source.owner, source.repo);
		const r = await resolveGithubSource(source, pathAfterRef);
		const files = await githubFiles(r.owner, r.repo, r.sha);
		const found = discoverModules(files, r.path).modules.find((m) => m.id === wantedId);
		return found ? { mod: found, origin: { type: 'github', ...r, path: found.dir } } : null;
	});
	const analyses: ModuleAnalysis[] = [];
	for (const e of plan.entries) analyses.push(await analyzeModule(e.mod));
	const blockers = [
		...plan.blockers,
		...analyses.flatMap((a) => a.blockers.map((b) => `${a.id}: ${b}`))
	];
	if (plan.entries.length && plan.entries.every((_, i) => analyses[i]!.action === 'unchanged')) {
		blockers.push(t('install.service.alreadyInstalled'));
	}
	const token = store({
		kind: 'plan',
		userId,
		expires: Date.now() + SESSION_MS,
		plan,
		analyses,
		blockers
	});
	return {
		token,
		entries: plan.entries.map((e, i) => ({
			...analyses[i]!,
			reason: e.reason,
			requiredBy: e.requiredBy,
			...originLabel(e.origin)
		})),
		satisfied: plan.satisfied,
		recommended: plan.recommended,
		blockers,
		status: installStatus()
	};
}

// --- Ausführen ----------------------------------------------------------------------------------

export interface InstallResult {
	installed: { id: string; version: string; action: string }[];
	/** Neustart bzw. Neubau nötig, damit die Module geladen werden */
	restartRequired: boolean;
	/** Supervisor baut neu (Fortschritt über `readSupervisorStatus`) */
	planId: string | null;
}

async function writeModule(id: string, files: ArchiveFiles): Promise<void> {
	const root = runtimeModulesDir();
	const dir = resolve(root, id);
	if (!dir.startsWith(resolve(root) + sep))
		throw errors.badRequest(t('install.service.invalidModuleDir'));
	await rm(dir, { recursive: true, force: true });
	for (const [rel, data] of files) {
		const target = resolve(dir, rel);
		if (!target.startsWith(dir + sep))
			throw errors.badRequest(t('install.service.invalidModulePath'));
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, data);
	}
}

export async function confirmInstall(
	ctx: RequestContext,
	input: { token: string; password: string; totp?: string }
): Promise<InstallResult> {
	const userId = await assertInstaller(ctx);
	const session = take(input.token, 'plan', userId);
	await verifyReauth(userId, { password: input.password, totp: input.totp }, 'module-install');
	if (session.blockers.length) throw errors.conflict(t('install.service.blocked'));
	const status = installStatus();
	if (!status.available)
		throw errors.unavailable(status.reason ?? t('install.service.notPossible'));

	if (status.mode === 'supervisor') return requestBuild(ctx, userId, session, input.token);

	acquireMaintenanceLock('install.lockLabel');
	const installed: InstallResult['installed'] = [];
	try {
		for (const [i, entry] of session.plan.entries.entries()) {
			const a = session.analyses[i]!;
			if (a.action === 'unchanged') continue;
			const sourceJson = { ...entry.origin } as Record<string, unknown>;
			delete sourceJson.type;
			delete sourceJson.sha;
			const commit = entry.origin.type === 'github' ? entry.origin.sha : null;
			const base = {
				moduleId: a.id,
				action: a.action,
				fromVersion: a.installedVersion,
				toVersion: a.version,
				sourceType: entry.origin.type,
				source: sourceJson,
				commit,
				contentHash: a.contentHash,
				actorId: userId
			};
			try {
				await writeModule(a.id, entry.mod.files);
			} catch (e) {
				await getDb()
					.insert(schema.moduleInstallEvent)
					.values({
						id: crypto.randomUUID(),
						...base,
						status: 'failed',
						detail: String(e).slice(0, 500)
					});
				throw e;
			}
			const db = getDb();
			await db
				.insert(schema.moduleInstall)
				.values({
					id: a.id,
					version: a.version,
					sourceType: entry.origin.type,
					source: sourceJson,
					commit,
					contentHash: a.contentHash,
					installedBy: userId
				})
				.onConflictDoUpdate({
					target: schema.moduleInstall.id,
					set: {
						version: a.version,
						sourceType: entry.origin.type,
						source: sourceJson,
						commit,
						contentHash: a.contentHash,
						installedAt: new Date(),
						installedBy: userId
					}
				});
			await db.insert(schema.moduleInstallEvent).values({
				id: crypto.randomUUID(),
				...base,
				status: 'done',
				detail: 'install.detail.copied'
			});
			installed.push({ id: a.id, version: a.version, action: a.action });
			await auditFromContext(ctx, 'core.module.installed', {
				target: a.id,
				metadata: { action: a.action, version: a.version, sourceType: entry.origin.type, commit }
			});
		}
	} finally {
		releaseMaintenanceLock();
	}
	sessions.delete(input.token);
	return { installed, restartRequired: installed.length > 0, planId: null };
}

/** Supervisor-Modus: Dateien ablegen, Verlauf „angefordert“, Neubau per IPC anstoßen */
async function requestBuild(
	ctx: RequestContext,
	userId: string,
	session: PlanSession,
	token: string
): Promise<InstallResult> {
	const planId = randomBytes(12).toString('base64url');
	const modules: BuildRequest['modules'] = {};
	const files = new Map<string, ArchiveFiles>();
	const installed: InstallResult['installed'] = [];
	const db = getDb();
	for (const [i, entry] of session.plan.entries.entries()) {
		const a = session.analyses[i]!;
		if (a.action === 'unchanged') continue;
		const sourceJson = { ...entry.origin } as Record<string, unknown>;
		delete sourceJson.type;
		delete sourceJson.sha;
		const commit = entry.origin.type === 'github' ? entry.origin.sha : null;
		modules[a.id] = {
			version: a.version,
			sourceType: entry.origin.type,
			source: sourceJson,
			commit,
			contentHash: a.contentHash
		};
		files.set(a.id, entry.mod.files);
		await db.insert(schema.moduleInstallEvent).values({
			id: crypto.randomUUID(),
			moduleId: a.id,
			action: a.action,
			fromVersion: a.installedVersion,
			toVersion: a.version,
			sourceType: entry.origin.type,
			source: sourceJson,
			commit,
			contentHash: a.contentHash,
			actorId: userId,
			planId,
			status: 'requested',
			detail: 'install.detail.buildRequested'
		});
		installed.push({ id: a.id, version: a.version, action: a.action });
		await auditFromContext(ctx, 'core.module.install_requested', {
			target: a.id,
			metadata: {
				action: a.action,
				version: a.version,
				sourceType: entry.origin.type,
				commit,
				planId
			}
		});
	}
	await requestSupervisorBuild(
		{ planId, requestedBy: userId, requestedAt: new Date().toISOString(), modules, remove: [] },
		files
	);
	sessions.delete(token);
	return { installed, restartRequired: installed.length > 0, planId };
}

// --- Verlauf ------------------------------------------------------------------------------------

/** Gespeicherter Verlaufstext: Schlüssel `install.detail.*` (auch ältere deutsche Texte) in der Sprache des Requests */
const LEGACY_DETAILS: Record<string, string> = {
	'Dateien kopiert': 'install.detail.copied',
	'Neubau angefordert': 'install.detail.buildRequested',
	'Entfernt, Daten gelöscht': 'install.detail.removedDataDeleted',
	'Entfernt, Daten behalten': 'install.detail.removedDataKept'
};

function eventDetail(detail: string | null): string | null {
	if (!detail) return detail;
	const key = LEGACY_DETAILS[detail] ?? detail;
	return /^install\.detail\.[a-zA-Z]+$/.test(key) ? t(key) : detail;
}

export async function listInstallEvents(ctx: RequestContext, limit = 100) {
	await requirePermission(ctx, 'core.modules.view');
	const rows = await getDb()
		.select()
		.from(schema.moduleInstallEvent)
		.orderBy(desc(schema.moduleInstallEvent.createdAt))
		.limit(Math.min(Math.max(limit, 1), 500));
	return rows.map((r) => ({
		id: r.id,
		moduleId: r.moduleId,
		action: r.action,
		fromVersion: r.fromVersion,
		toVersion: r.toVersion,
		sourceType: r.sourceType,
		source: r.source,
		commit: r.commit,
		status: r.status,
		detail: eventDetail(r.detail),
		actorId: r.actorId,
		createdAt: r.createdAt.toISOString()
	}));
}

export async function listInstalledSources(ctx: RequestContext) {
	await requirePermission(ctx, 'core.modules.view');
	const rows = await getDb().select().from(schema.moduleInstall);
	return rows.map((r) => ({
		id: r.id,
		version: r.version,
		sourceType: r.sourceType,
		source: r.source,
		commit: r.commit,
		contentHash: r.contentHash,
		installedAt: r.installedAt.toISOString()
	}));
}
