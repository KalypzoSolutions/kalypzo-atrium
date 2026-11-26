/**
 * Lebenszyklus installierter Module (Kalypzo Atrium, Phase 7):
 * - `checkUpdates`: je Modul aus GitHub den Kopf des Refs mit dem gespeicherten Commit vergleichen,
 * - `uninstallModule` / `uninstallModules`: entfernen (Daten behalten oder vollständig löschen), danach Neubau bzw.
 *   Kopie entfernen (mehrere Module: eine Re-Auth, ein gemeinsamer Neubau),
 * - `installDrift` / `restoreFromDatabase`: Wunschzustand (`module_install`) gegen den laufenden Stand – z. B. nach
 *   Verlust des Volumes oder Wiederherstellen einer Sicherung auf einem neuen Server – und Module neu einspielen,
 * - `syncInstallsFromLock`: beim Start Einträge der Lock-Datei (Seed, frühere Builds) in `module_install` übernehmen,
 */
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { eq, like, or, sql } from 'drizzle-orm';
import { localized, t } from '$lib/i18n';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../../audit/service';
import { systemContext } from '../../auth/context';
import { getDb, schema } from '../../database/client';
import { errors } from '../../errors';
import { requirePermission } from '../../permissions/service';
import { removeMany } from '../../storage';
import { verifyReauth } from '../../system/maintenance';
import { formatModuleSource } from '../package/schema';
import { allDefinitions, getDefinition } from '../registry';
import { invalidateModuleStateCache } from '../state';
import { moduleSchemaName } from '../types';
import { type ArchiveFiles, contentHash, readModuleArchive } from './archive';
import { discoverModules } from './discover';
import { downloadGithubArchive, resolveGithubSource } from './github';
import { assertInstaller, installStatus, runtimeModulesDir } from './service';
import {
	cachedUpload,
	type LockEntry,
	requestSupervisorBuild,
	supervisorDataDir
} from './supervisor-link';

const MODULE_ID = /^[a-z][a-z0-9-]{1,30}$/;

interface GithubSourceJson {
	owner?: string;
	repo?: string;
	path?: string;
	ref?: string;
}

function githubLabel(s: GithubSourceJson): string {
	return formatModuleSource({
		type: 'github',
		owner: String(s.owner),
		repo: String(s.repo),
		path: String(s.path ?? ''),
		ref: s.ref ? String(s.ref) : null
	});
}

// --- Updates ------------------------------------------------------------------------------------

export interface UpdateInfo {
	id: string;
	name: string;
	installedVersion: string;
	commit: string | null;
	/** `github:owner/repo/pfad#ref` (auch für die Installationsseite) */
	source: string | null;
	latestCommit: string | null;
	latestVersion: string | null;
	status: 'current' | 'update' | 'no-source' | 'error';
	message: string | null;
}

/** `ids`: nur diese Module prüfen (Sammelaktion); ohne Angabe alle installierten */
export async function checkUpdates(ctx: RequestContext, ids?: string[]): Promise<UpdateInfo[]> {
	await assertInstaller(ctx);
	const only = ids ? new Set(ids) : null;
	const rows = (await getDb().select().from(schema.moduleInstall)).filter(
		(r) => !only || only.has(r.id)
	);
	const out: UpdateInfo[] = [];
	for (const r of rows.sort((a, b) => a.id.localeCompare(b.id))) {
		const base: UpdateInfo = {
			id: r.id,
			name: localized(getDefinition(r.id)?.manifest.name) || r.id,
			installedVersion: r.version,
			commit: r.commit,
			source: null,
			latestCommit: null,
			latestVersion: null,
			status: 'no-source',
			message: r.sourceType === 'upload' ? t('install.manage.fromZip') : null
		};
		if (r.sourceType !== 'github') {
			out.push(base);
			continue;
		}
		const src = r.source as GithubSourceJson;
		base.source = githubLabel(src);
		try {
			const resolved = await resolveGithubSource({
				type: 'github',
				owner: String(src.owner),
				repo: String(src.repo),
				path: String(src.path ?? ''),
				ref: src.ref ? String(src.ref) : null
			});
			base.latestCommit = resolved.sha;
			if (resolved.sha === r.commit) {
				out.push({ ...base, status: 'current', latestVersion: r.version });
				continue;
			}
			const files = readModuleArchive(
				await downloadGithubArchive(resolved.owner, resolved.repo, resolved.sha)
			);
			const found = discoverModules(files, String(src.path ?? '')).modules.find(
				(m) => m.id === r.id
			);
			out.push({
				...base,
				status: found ? 'update' : 'error',
				latestVersion: found?.pkg.version ?? null,
				message: found ? null : t('install.manage.goneFromSource')
			});
		} catch (e) {
			out.push({ ...base, status: 'error', message: e instanceof Error ? e.message : String(e) });
		}
	}
	return out;
}

// --- Entfernen ----------------------------------------------------------------------------------

/**
 * Alle Daten eines Moduls löschen: Schema, Migrationsstand, Zustand, Rechte (samt Rollen-/Einzelrechten),
 * Rollen-Verleihungen, Einstellungen, Benachrichtigungs-Einstellungen, Job-Läufe und Dateien.
 */
export async function deleteModuleData(id: string): Promise<{ files: number; warnings: string[] }> {
	if (!MODULE_ID.test(id)) throw errors.badRequest(t('install.manage.invalidId'));
	const warnings: string[] = [];
	const db = getDb();
	// Dateien zuerst (Storage braucht die Metadaten); ohne Speicher nur die Einträge
	const fileRows = await db
		.select({ path: schema.file.path })
		.from(schema.file)
		.where(eq(schema.file.moduleId, id));
	let removed = 0;
	if (fileRows.length) {
		try {
			removed = (
				await removeMany(systemContext('module-uninstall'), {
					module: id,
					paths: fileRows.map((f) => f.path)
				})
			).removed;
		} catch (e) {
			warnings.push(
				t('install.manage.filesNotDeleted', { error: e instanceof Error ? e.message : String(e) })
			);
		}
	}
	const prefix = `${id}.%`;
	await db.transaction(async (tx) => {
		await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS "${moduleSchemaName(id)}" CASCADE`));
		await tx.delete(schema.file).where(eq(schema.file.moduleId, id));
		await tx.delete(schema.moduleMigration).where(eq(schema.moduleMigration.moduleId, id));
		await tx.delete(schema.moduleState).where(eq(schema.moduleState.id, id));
		await tx.delete(schema.roleGrantApplied).where(eq(schema.roleGrantApplied.moduleId, id));
		await tx.delete(schema.userRoleGrant).where(eq(schema.userRoleGrant.moduleId, id));
		// Rechte (role_permission/user_permission hängen per FK CASCADE daran)
		await tx.delete(schema.permission).where(eq(schema.permission.moduleId, id));
		await tx.delete(schema.setting).where(like(schema.setting.key, prefix));
		await tx.delete(schema.notificationPref).where(like(schema.notificationPref.typeKey, prefix));
		await tx.delete(schema.jobRun).where(like(schema.jobRun.key, prefix));
	});
	invalidateModuleStateCache();
	return { files: removed, warnings };
}

export interface UninstallResult {
	id: string;
	dataDeleted: boolean;
	warnings: string[];
	/** Neubau über den Supervisor angefordert */
	planId: string | null;
}

/** Deutsches Bestätigungswort für „Daten löschen“ bei mehreren Modulen – gilt in jeder Sprache zusätzlich */
export const UNINSTALL_CONFIRM_WORD = 'ENTFERNEN';

/** Bestätigungswort in der aktuellen Sprache (Anzeige und Prüfung) */
export function uninstallConfirmWord(): string {
	return t('install.manage.confirmWord');
}

/** Eingabe = Wort der aktuellen Sprache oder das deutsche Wort */
export function isUninstallConfirmWord(input: string): boolean {
	return input === uninstallConfirmWord() || input === UNINSTALL_CONFIRM_WORD;
}

/** Höchstzahl an Modulen je Sammel-Entfernen */
export const UNINSTALL_MAX_IDS = 100;

export interface UninstallManyResult {
	ids: string[];
	dataDeleted: boolean;
	warnings: string[];
	/** Ein gemeinsamer Neubau über den Supervisor für alle Module mit Code */
	planId: string | null;
	/** Je Modul (Reihenfolge wie `ids`) */
	results: UninstallResult[];
}

interface UninstallTarget {
	id: string;
	state: typeof schema.moduleState.$inferSelect | undefined;
	row: typeof schema.moduleInstall.$inferSelect | undefined;
	def: ReturnType<typeof getDefinition>;
	removeCode: boolean;
}

/**
 * Gemeinsamer Ablauf für Einzel- und Sammel-Entfernen: erst alle Prüfungen für alle IDs (unbekannt 404, aktiv 409,
 * abhängige Module außerhalb der Auswahl 409), dann `checkConfirm` (Bestätigung beim Löschen der Daten), EINE Re-Auth,
 * Ausführmodus prüfen; danach Daten löschen, Code entfernen (Kopie je Verzeichnis bzw. EIN Supervisor-Neubau),
 * je Modul ein `module_install_event` und ein Audit `core.module.uninstalled`.
 */
async function uninstallMany(
	ctx: RequestContext,
	userId: string,
	ids: string[],
	input: { deleteData: boolean; password: string; totp?: string; bulk: boolean },
	checkConfirm: () => void
): Promise<UninstallManyResult> {
	const db = getDb();
	const selected = new Set(ids);
	const targets: UninstallTarget[] = [];
	const unknown: string[] = [];
	for (const id of ids) {
		if (!MODULE_ID.test(id)) {
			unknown.push(id);
			continue;
		}
		const [state] = await db.select().from(schema.moduleState).where(eq(schema.moduleState.id, id));
		const [row] = await db
			.select()
			.from(schema.moduleInstall)
			.where(eq(schema.moduleInstall.id, id));
		const def = getDefinition(id);
		if (!def && !state && !row) {
			unknown.push(id);
			continue;
		}
		targets.push({
			id,
			state,
			row,
			def,
			removeCode: !!def || existsSync(join(runtimeModulesDir(), id))
		});
	}
	if (unknown.length) {
		throw errors.notFound(
			input.bulk
				? t('install.manage.notFoundIds', { ids: unknown.join(', ') })
				: t('install.manage.notFound')
		);
	}
	const active = targets.filter((x) => x.state?.enabled).map((x) => x.id);
	if (active.length) {
		throw errors.conflict(
			input.bulk
				? t('install.manage.activeIds', { ids: active.join(', ') })
				: t('install.manage.active')
		);
	}
	// Abhängigkeiten innerhalb der Auswahl sind erlaubt (werden mit entfernt)
	const dependents = allDefinitions()
		.filter(
			(d) =>
				!selected.has(d.manifest.id) && d.manifest.dependencies.some((dep) => selected.has(dep))
		)
		.map((d) => d.manifest.id);
	if (dependents.length) {
		throw errors.conflict(t('install.manage.dependents', { ids: dependents.join(', ') }));
	}
	if (input.deleteData) checkConfirm();
	await verifyReauth(userId, { password: input.password, totp: input.totp }, 'module-install');
	const status = installStatus();
	// Nur Daten löschen geht immer; Code entfernen braucht copy/supervisor
	const withCode = targets.filter((x) => x.removeCode).map((x) => x.id);
	if (withCode.length && !status.available) {
		throw errors.unavailable(status.reason ?? t('install.manage.removeNotPossible'));
	}

	const warnings: string[] = [];
	const results: UninstallResult[] = [];
	const eventIds = new Map<string, string>();
	const eligible: UninstallTarget[] = [];
	const planId =
		withCode.length && status.mode === 'supervisor' ? crypto.randomUUID().replace(/-/g, '') : null;

	for (const x of targets) {
		const moduleWarnings: string[] = [];
		let dataDeleted = false;
		let failed = false;
		if (input.deleteData) {
			try {
				moduleWarnings.push(...(await deleteModuleData(x.id)).warnings);
				dataDeleted = true;
			} catch (e) {
				failed = true;
				moduleWarnings.push(
					t('install.manage.removeFailed', {
						id: x.id,
						error: e instanceof Error ? e.message : String(e)
					})
				);
			}
		}
		const eventId = crypto.randomUUID();
		const modulePlan = x.removeCode && !failed ? planId : null;
		await db.insert(schema.moduleInstallEvent).values({
			id: eventId,
			moduleId: x.id,
			action: 'uninstall',
			fromVersion: x.def?.manifest.version ?? x.row?.version ?? x.state?.installedVersion ?? null,
			toVersion: null,
			sourceType: x.row?.sourceType ?? null,
			source: x.row?.source ?? {},
			commit: x.row?.commit ?? null,
			contentHash: x.row?.contentHash ?? null,
			actorId: userId,
			planId: modulePlan,
			status: failed ? 'failed' : 'requested',
			detail: dataDeleted ? 'install.detail.removedDataDeleted' : 'install.detail.removedDataKept'
		});
		await auditFromContext(ctx, 'core.module.uninstalled', {
			target: x.id,
			metadata: input.bulk
				? { dataDeleted, planId: modulePlan, bulk: true, count: ids.length }
				: { dataDeleted, planId: modulePlan }
		});
		eventIds.set(x.id, eventId);
		if (!failed) eligible.push(x);
		warnings.push(...moduleWarnings);
		results.push({ id: x.id, dataDeleted, warnings: moduleWarnings, planId: modulePlan });
	}

	const fail = async (id: string, e: unknown) => {
		const message = t('install.manage.removeFailed', {
			id,
			error: e instanceof Error ? e.message : String(e)
		});
		warnings.push(message);
		results.find((r) => r.id === id)!.warnings.push(message);
		await db
			.update(schema.moduleInstallEvent)
			.set({ status: 'failed' })
			.where(eq(schema.moduleInstallEvent.id, eventIds.get(id)!));
	};
	if (status.mode === 'copy') {
		const root = resolve(runtimeModulesDir());
		for (const x of eligible) {
			try {
				if (x.removeCode) {
					const dir = resolve(root, x.id);
					if (!dir.startsWith(root + sep))
						throw errors.badRequest(t('install.service.invalidModuleDir'));
					await rm(dir, { recursive: true, force: true });
				}
				await db.delete(schema.moduleInstall).where(eq(schema.moduleInstall.id, x.id));
				await db
					.update(schema.moduleInstallEvent)
					.set({ status: 'done' })
					.where(eq(schema.moduleInstallEvent.id, eventIds.get(x.id)!));
			} catch (e) {
				await fail(x.id, e);
			}
		}
	} else {
		const code = eligible.filter((x) => x.removeCode);
		let planFailed = false;
		if (code.length && planId) {
			try {
				await requestSupervisorBuild(
					{
						planId,
						requestedBy: userId,
						requestedAt: new Date().toISOString(),
						modules: {},
						remove: code.map((x) => x.id)
					},
					new Map()
				);
			} catch (e) {
				planFailed = true;
				for (const x of code) await fail(x.id, e);
			}
		}
		for (const x of eligible) {
			if (x.removeCode && planFailed) continue;
			try {
				await db.delete(schema.moduleInstall).where(eq(schema.moduleInstall.id, x.id));
				if (!x.removeCode)
					await db
						.update(schema.moduleInstallEvent)
						.set({ status: 'done' })
						.where(eq(schema.moduleInstallEvent.id, eventIds.get(x.id)!));
			} catch (e) {
				await fail(x.id, e);
			}
		}
	}

	return { ids, dataDeleted: results.every((r) => r.dataDeleted), warnings, planId, results };
}

export async function uninstallModule(
	ctx: RequestContext,
	input: { id: string; deleteData: boolean; confirmId?: string; password: string; totp?: string }
): Promise<UninstallResult> {
	const userId = await assertInstaller(ctx);
	const id = String(input.id ?? '');
	const r = await uninstallMany(
		ctx,
		userId,
		[id],
		{ deleteData: input.deleteData, password: input.password, totp: input.totp, bulk: false },
		() => {
			if (input.confirmId !== id) {
				throw errors.validation([
					{ path: ['confirmId'], message: t('install.manage.confirmId', { id }) }
				]);
			}
		}
	);
	return r.results[0]!;
}

/**
 * Mehrere Module auf einmal entfernen (Sammelaktion). Beim Löschen der Daten muss `confirm` das Bestätigungswort
 * sein (`uninstallConfirmWord()`, das deutsche `ENTFERNEN` gilt immer); Feldfehler unter `confirm`.
 */
export async function uninstallModules(
	ctx: RequestContext,
	input: { ids: string[]; deleteData: boolean; confirm?: string; password: string; totp?: string }
): Promise<UninstallManyResult> {
	const userId = await assertInstaller(ctx);
	const ids = [...new Set((input.ids ?? []).map((id) => String(id)))];
	if (!ids.length) {
		throw errors.validation([{ path: ['ids'], message: t('install.manage.noIds') }]);
	}
	if (ids.length > UNINSTALL_MAX_IDS) {
		throw errors.validation([
			{ path: ['ids'], message: t('install.manage.tooMany', { max: UNINSTALL_MAX_IDS }) }
		]);
	}
	return uninstallMany(
		ctx,
		userId,
		ids,
		{ deleteData: input.deleteData, password: input.password, totp: input.totp, bulk: true },
		() => {
			if (!isUninstallConfirmWord(String(input.confirm ?? ''))) {
				throw errors.validation([
					{
						path: ['confirm'],
						message: t('install.manage.confirmWordHint', { word: uninstallConfirmWord() })
					}
				]);
			}
		}
	);
}

// --- Wunschzustand gegen laufenden Stand --------------------------------------------------------

/** Lock-Datei der laufenden Generation (unter dem Supervisor), sonst `null` */
export function runningLock(): { modules: Record<string, LockEntry> } | null {
	const data = supervisorDataDir();
	const gen = process.env.ATRIUM_GENERATION;
	if (!data || !gen || gen === 'base') return null;
	try {
		return JSON.parse(readFileSync(join(data, 'gen', gen, 'atrium-modules.lock.json'), 'utf8'));
	} catch {
		return null;
	}
}

export interface DriftEntry {
	id: string;
	version: string;
	source: string;
	/** `missing`: nicht im laufenden Stand; `changed`: anderer Inhalt als gespeichert */
	kind: 'missing' | 'changed';
	restorable: boolean;
}

export async function installDrift(ctx: RequestContext): Promise<DriftEntry[]> {
	await requirePermission(ctx, 'core.modules.view');
	const rows = await getDb().select().from(schema.moduleInstall);
	const lock = runningLock();
	const out: DriftEntry[] = [];
	for (const r of rows) {
		const loaded = !!getDefinition(r.id);
		const locked = lock?.modules[r.id];
		const kind: DriftEntry['kind'] | null = !loaded
			? 'missing'
			: locked && locked.contentHash !== r.contentHash
				? 'changed'
				: null;
		if (!kind) continue;
		const source =
			r.sourceType === 'github'
				? githubLabel(r.source as GithubSourceJson)
				: `ZIP ${String((r.source as { fileName?: string }).fileName ?? '')}`;
		const restorable =
			r.sourceType === 'github'
				? !!r.commit
				: r.sourceType === 'upload' &&
					existsSync(
						join(
							supervisorDataDir() ?? '.',
							'sources',
							`${String((r.source as { zipSha256?: string }).zipSha256 ?? '')}.zip`
						)
					);
		out.push({ id: r.id, version: r.version, source, kind, restorable });
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Module laut Datenbank (Quelle + Commit) neu einspielen und neu bauen (nur Supervisor) */
export async function restoreFromDatabase(
	ctx: RequestContext,
	input: { password: string; totp?: string }
): Promise<{ planId: string; modules: string[] }> {
	const userId = await assertInstaller(ctx);
	await verifyReauth(userId, { password: input.password, totp: input.totp }, 'module-install');
	const status = installStatus();
	if (status.mode !== 'supervisor' || !status.available) {
		throw errors.unavailable(status.reason ?? t('install.manage.restoreNeedsSupervisor'));
	}
	const drift = (await installDrift(ctx)).filter((d) => d.restorable);
	if (!drift.length) throw errors.conflict(t('install.manage.nothingToRestore'));
	const rows = await getDb()
		.select()
		.from(schema.moduleInstall)
		.where(or(...drift.map((d) => eq(schema.moduleInstall.id, d.id))));
	const modules: Record<string, LockEntry> = {};
	const files = new Map<string, ArchiveFiles>();
	for (const r of rows) {
		const src = r.source as GithubSourceJson & { zipSha256?: string };
		let all: ArchiveFiles;
		if (r.sourceType === 'github') {
			all = readModuleArchive(
				await downloadGithubArchive(String(src.owner), String(src.repo), String(r.commit))
			);
		} else {
			const zip = await cachedUpload(String(src.zipSha256 ?? ''));
			if (!zip) continue;
			all = readModuleArchive(zip);
		}
		const found = discoverModules(all, String(src.path ?? '')).modules.find((m) => m.id === r.id);
		if (!found) throw errors.conflict(t('install.manage.notInSource', { id: r.id }));
		if (contentHash(found.files) !== r.contentHash) {
			throw errors.conflict(t('install.manage.contentDiffers', { id: r.id }));
		}
		modules[r.id] = {
			version: r.version,
			sourceType: r.sourceType as LockEntry['sourceType'],
			source: r.source,
			commit: r.commit,
			contentHash: r.contentHash
		};
		files.set(r.id, found.files);
	}
	const planId = crypto.randomUUID().replace(/-/g, '');
	await requestSupervisorBuild(
		{ planId, requestedBy: userId, requestedAt: new Date().toISOString(), modules, remove: [] },
		files
	);
	await auditFromContext(ctx, 'core.module.restore_requested', {
		metadata: { modules: Object.keys(modules), planId }
	});
	return { planId, modules: Object.keys(modules) };
}

/**
 * Beim Start: Einträge der laufenden Lock-Datei mit Quelle (GitHub/ZIP), die in `module_install` fehlen – z. B. aus
 * dem Seed eines frischen Deployments –, übernehmen. Eingebaute Module (`builtin`) bleiben außen vor.
 */
export async function syncInstallsFromLock(): Promise<number> {
	const lock = runningLock();
	if (!lock) return 0;
	const db = getDb();
	const have = new Set(
		(await db.select({ id: schema.moduleInstall.id }).from(schema.moduleInstall)).map((r) => r.id)
	);
	let added = 0;
	for (const [id, e] of Object.entries(lock.modules)) {
		if (have.has(id) || e.sourceType === 'builtin') continue;
		await db
			.insert(schema.moduleInstall)
			.values({
				id,
				version: e.version,
				sourceType: e.sourceType,
				source: e.source,
				commit: e.commit,
				contentHash: e.contentHash,
				installedBy: null
			})
			.onConflictDoNothing();
		added++;
	}
	return added;
}
