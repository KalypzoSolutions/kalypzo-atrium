/**
 * Update-Prüfung für Module aus GitHub-Quellen (Kalypzo Atrium, Updates 2.0):
 * - je Modul Kanal `release` (höchster Versions-Tag) oder `branch` (Kopf des gespeicherten Branches),
 * - je Repository und Commit nur **ein** Download, Repositories parallel (≤ 3),
 * - Vergleich über Inhaltshash + Version des Modulordners (ein neuer Commit an anderer Stelle im Repo ist kein Update),
 * - zu jedem Update Analyse (Rechte, Migrationen, npm, Sperren) und Änderungsnotizen (`CHANGELOG.md`, sonst Commits),
 * - Ergebnis je Modul in `module_update_check`; Benachrichtigung an Admins nur bei **neuen** Updates.
 * Regeln (Tag-Auswahl, Status, Changelog) liegen rein in `update-rules.ts`.
 */
import { eq } from 'drizzle-orm';
import { localized, t } from '$lib/i18n';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../../audit/service';
import { systemContext } from '../../auth/context';
import { getDb, schema } from '../../database/client';
import { logError } from '../../db-errors';
import { errors } from '../../errors';
import { sendNotifications } from '../../notifications/service';
import { usersWithPermission } from '../../permissions/service';
import { formatModuleSource } from '../package/schema';
import { getDefinition } from '../registry';
import { analyzeModule } from './analyze';
import { discoverModules } from './discover';
import { listPathCommits, listTags, resolveGithubSource } from './github';
import { assertInstaller, githubFiles, INSTALL_PERMISSION, installStatus } from './service';
import {
	changelogBetween,
	computeUpdateStatus,
	ignoreKey,
	normalizeChannel,
	pickReleaseTag,
	type ChangelogEntry,
	type TagRef,
	type UpdateChannel,
	type UpdateStatus
} from './update-rules';

const SHA_RE = /^[0-9a-f]{40}$/;
const PARALLEL_REPOS = 3;
const COMMITS_MAX = 20;

interface GithubSourceJson {
	owner?: string;
	repo?: string;
	path?: string;
	ref?: string | null;
}

/** Gespeicherte Details eines Prüflaufs (`module_update_check.details`) */
interface CheckDetails {
	changelog: ChangelogEntry[];
	commits: { sha: string; message: string }[];
	permissionsAdded: string[];
	newMigrations: string[];
	npmNew: string[];
	blockers: string[];
	/** i18n-Schlüssel oder freier Text (Fehler) */
	message: string | null;
}

export interface UpdateInfo {
	id: string;
	name: string;
	channel: UpdateChannel;
	installedVersion: string;
	commit: string | null;
	/** `github:owner/repo/pfad#ref`, sonst `null` (ZIP) */
	source: string | null;
	latestVersion: string | null;
	latestRef: string | null;
	latestCommit: string | null;
	status: UpdateStatus;
	/** Installiert ist neuer als der neueste Stand des Kanals */
	newerInstalled: boolean;
	message: string | null;
	changelog: ChangelogEntry[];
	commits: { sha: string; message: string }[];
	permissionsAdded: string[];
	newMigrations: string[];
	npmNew: string[];
	blockers: string[];
	checkedAt: string | null;
	/** Link auf den neuen Stand bei GitHub */
	latestUrl: string | null;
}

const EMPTY_DETAILS: CheckDetails = {
	changelog: [],
	commits: [],
	permissionsAdded: [],
	newMigrations: [],
	npmNew: [],
	blockers: [],
	message: null
};

function sourceOf(r: typeof schema.moduleInstall.$inferSelect): GithubSourceJson | null {
	return r.sourceType === 'github' ? (r.source as GithubSourceJson) : null;
}

function label(src: GithubSourceJson): string {
	return formatModuleSource({
		type: 'github',
		owner: String(src.owner),
		repo: String(src.repo),
		path: String(src.path ?? ''),
		ref: src.ref ? String(src.ref) : null
	});
}

/** Text eines gespeicherten Hinweises in der Sprache des Requests (Schlüssel `install.updates.*`) */
function messageText(m: string | null): string | null {
	if (!m) return null;
	return /^install\.updates\.[a-zA-Z]+$/.test(m) ? t(m) : m;
}

// --- Prüfen -------------------------------------------------------------------------------------

type InstallRow = typeof schema.moduleInstall.$inferSelect;

interface CheckOutcome {
	id: string;
	/** `ok` | `error` | `no-source` */
	result: 'ok' | 'error' | 'no-source';
	latestVersion: string | null;
	latestRef: string | null;
	latestCommit: string | null;
	latestContentHash: string | null;
	details: CheckDetails;
}

/** Alle Module eines Repositorys prüfen (ein Tag-Abruf, je Ref ein Kopf, je Commit ein Download) */
async function checkRepo(owner: string, repo: string, rows: InstallRow[]): Promise<CheckOutcome[]> {
	let tags: TagRef[] | null = null;
	/** Branch („“ = Standard-Branch) → Kopf */
	const heads = new Map<string, { ref: string; sha: string }>();
	const out: CheckOutcome[] = [];
	for (const r of rows) {
		const src = sourceOf(r)!;
		const base: CheckOutcome = {
			id: r.id,
			result: 'ok',
			latestVersion: null,
			latestRef: null,
			latestCommit: null,
			latestContentHash: null,
			details: { ...EMPTY_DETAILS }
		};
		try {
			const channel = normalizeChannel(r.channel);
			let ref: string;
			let sha: string;
			if (channel === 'release') {
				tags ??= await listTags(owner, repo);
				const tag = pickReleaseTag(tags, r.id, r.version);
				if (!tag) {
					out.push({
						...base,
						result: 'error',
						details: { ...EMPTY_DETAILS, message: 'install.updates.noReleaseTags' }
					});
					continue;
				}
				ref = tag.name;
				sha = tag.sha;
			} else {
				// Über einen festen Commit (Seed) installiert: dem Standard-Branch folgen
				const wanted = src.ref && !SHA_RE.test(String(src.ref)) ? String(src.ref) : '';
				let head = heads.get(wanted);
				if (!head) {
					const res = await resolveGithubSource({
						type: 'github',
						owner,
						repo,
						path: String(src.path ?? ''),
						ref: wanted || null
					});
					head = { ref: res.ref, sha: res.sha };
					heads.set(wanted, head);
				}
				ref = head.ref;
				sha = head.sha;
			}
			base.latestRef = ref;
			base.latestCommit = sha;
			// Gleicher Commit ⇒ gleicher Inhalt: kein Download nötig
			if (sha === r.commit) {
				out.push({ ...base, latestVersion: r.version, latestContentHash: r.contentHash });
				continue;
			}
			const files = await githubFiles(owner, repo, sha);
			const found = discoverModules(files, String(src.path ?? '')).modules.find(
				(m) => m.id === r.id
			);
			if (!found) {
				out.push({
					...base,
					result: 'error',
					details: { ...EMPTY_DETAILS, message: 'install.updates.goneFromSource' }
				});
				continue;
			}
			base.latestVersion = found.pkg.version;
			base.latestContentHash = found.contentHash;
			if (found.contentHash === r.contentHash) {
				out.push(base);
				continue;
			}
			const analysis = await analyzeModule(found);
			const changelogFile = found.files.get('CHANGELOG.md');
			const changelog = changelogFile
				? changelogBetween(new TextDecoder().decode(changelogFile), r.version, found.pkg.version)
				: [];
			let commits: CheckDetails['commits'] = [];
			if (!changelog.length && r.commit) {
				commits = await listPathCommits(owner, repo, sha, found.dir, r.commit, COMMITS_MAX).catch(
					(e) => {
						logError('[modules] Commits für Änderungsnotizen nicht lesbar', e, { target: r.id });
						return [];
					}
				);
			}
			out.push({
				...base,
				details: {
					changelog,
					commits,
					permissionsAdded: analysis.permissionsAdded,
					newMigrations: analysis.newMigrations,
					npmNew: analysis.npm.filter((n) => n.status === 'new').map((n) => n.name),
					blockers: analysis.blockers,
					message: null
				}
			});
		} catch (e) {
			out.push({
				...base,
				result: 'error',
				details: { ...EMPTY_DETAILS, message: e instanceof Error ? e.message : String(e) }
			});
		}
	}
	return out;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(size, items.length) }, async () => {
			while (next < items.length) await fn(items[next++]!);
		})
	);
}

export interface UpdateRunResult {
	checked: number;
	/** Module mit verfügbarem Update (ohne ignorierte/gesperrte) */
	updates: string[];
	errors: number;
	notified: number;
}

/**
 * Alle installierten Module prüfen und das Ergebnis speichern (ohne Rechteprüfung – Aufrufer prüft bzw. Job).
 * Benachrichtigt Admins über Updates, die beim letzten Lauf noch nicht gemeldet waren.
 */
export async function runUpdateCheck(ids?: string[]): Promise<UpdateRunResult> {
	const db = getDb();
	const installed = await db.select().from(schema.moduleInstall);
	const only = ids ? new Set(ids) : null;
	const rows = only ? installed.filter((row) => only.has(row.id)) : installed;
	const byRepo = new Map<string, { owner: string; repo: string; rows: InstallRow[] }>();
	const outcomes: CheckOutcome[] = [];
	for (const r of rows) {
		const src = sourceOf(r);
		if (!src?.owner || !src.repo) {
			outcomes.push({
				id: r.id,
				result: 'no-source',
				latestVersion: null,
				latestRef: null,
				latestCommit: null,
				latestContentHash: null,
				details: {
					...EMPTY_DETAILS,
					message: r.sourceType === 'upload' ? 'install.updates.fromZip' : null
				}
			});
			continue;
		}
		const key = `${src.owner}/${src.repo}`.toLowerCase();
		const entry = byRepo.get(key) ?? { owner: String(src.owner), repo: String(src.repo), rows: [] };
		entry.rows.push(r);
		byRepo.set(key, entry);
	}
	await pool([...byRepo.values()], PARALLEL_REPOS, async (g) => {
		outcomes.push(...(await checkRepo(g.owner, g.repo, g.rows)));
	});

	const now = new Date();
	const previous = new Map(
		(await db.select().from(schema.moduleUpdateCheck)).map((c) => [c.id, c])
	);
	const fresh: string[] = [];
	const available: string[] = [];
	for (const o of outcomes) {
		const row = rows.find((r) => r.id === o.id)!;
		const status = statusOf(row, o);
		let notifiedKey = previous.get(o.id)?.notifiedKey ?? null;
		if ((status.status === 'update' || status.status === 'changed') && o.latestContentHash) {
			available.push(o.id);
			const key = ignoreKey(o.latestVersion ?? '', o.latestContentHash);
			if (notifiedKey !== key) {
				fresh.push(o.id);
				notifiedKey = key;
			}
		}
		const values = {
			checkedAt: now,
			result: o.result,
			latestVersion: o.latestVersion,
			latestRef: o.latestRef,
			latestCommit: o.latestCommit,
			latestContentHash: o.latestContentHash,
			details: o.details as unknown as Record<string, unknown>,
			notifiedKey
		};
		await db
			.insert(schema.moduleUpdateCheck)
			.values({ id: o.id, ...values })
			.onConflictDoUpdate({ target: schema.moduleUpdateCheck.id, set: values });
	}
	// Einträge entfernter Module aufräumen
	for (const id of previous.keys()) {
		if (!installed.some((r) => r.id === id)) {
			await db.delete(schema.moduleUpdateCheck).where(eq(schema.moduleUpdateCheck.id, id));
		}
	}
	const notified = fresh.length ? await notifyAdmins(fresh) : 0;
	return {
		checked: outcomes.length,
		updates: available.sort(),
		errors: outcomes.filter((o) => o.result === 'error').length,
		notified
	};
}

function statusOf(
	row: InstallRow,
	o: Pick<CheckOutcome, 'result' | 'latestVersion' | 'latestContentHash' | 'details'>
): { status: UpdateStatus; newerInstalled: boolean } {
	if (o.result === 'no-source') return { status: 'no-source', newerInstalled: false };
	if (o.result === 'error') return { status: 'error', newerInstalled: false };
	return computeUpdateStatus({
		installed: { version: row.version, contentHash: row.contentHash },
		latest:
			o.latestVersion && o.latestContentHash
				? { version: o.latestVersion, contentHash: o.latestContentHash }
				: null,
		ignored: row.ignoredUpdate,
		blockers: o.details.blockers
	});
}

async function notifyAdmins(ids: string[]): Promise<number> {
	try {
		const userIds = await usersWithPermission(INSTALL_PERMISSION);
		if (!userIds.length) return 0;
		const names = ids.map((id) => localized(getDefinition(id)?.manifest.name) || id);
		const r = await sendNotifications(systemContext(), 'core', [
			{
				type: 'module-updates',
				userIds,
				title: t('install.updates.notifyTitle', { count: ids.length }),
				body: t('install.updates.notifyBody', { list: names.join(', ') }),
				link: '/admin/modules',
				tag: 'module-updates'
			}
		]);
		return r.email + r.push + r.queued;
	} catch (e) {
		logError('[modules] Benachrichtigung über Updates fehlgeschlagen', e);
		return 0;
	}
}

// --- Lesen und Einstellen -----------------------------------------------------------------------

/** Letzter Prüfstand je installiertem Modul (ohne Netz), sortiert nach ID */
export async function listUpdateChecks(ctx: RequestContext): Promise<UpdateInfo[]> {
	await assertInstaller(ctx);
	const db = getDb();
	const rows = await db.select().from(schema.moduleInstall);
	const checks = new Map((await db.select().from(schema.moduleUpdateCheck)).map((c) => [c.id, c]));
	return rows
		.sort((a, b) => a.id.localeCompare(b.id))
		.map((r) => {
			const c = checks.get(r.id);
			const src = sourceOf(r);
			const details: CheckDetails = { ...EMPTY_DETAILS, ...((c?.details ?? {}) as object) };
			const st = c
				? statusOf(r, {
						result: c.result as CheckOutcome['result'],
						latestVersion: c.latestVersion,
						latestContentHash: c.latestContentHash,
						details
					})
				: { status: (src ? 'unchecked' : 'no-source') as UpdateStatus, newerInstalled: false };
			return {
				id: r.id,
				name: localized(getDefinition(r.id)?.manifest.name) || r.id,
				channel: normalizeChannel(r.channel),
				installedVersion: r.version,
				commit: r.commit,
				source: src ? label(src) : null,
				latestVersion: c?.latestVersion ?? null,
				latestRef: c?.latestRef ?? null,
				latestCommit: c?.latestCommit ?? null,
				status: st.status,
				newerInstalled: st.newerInstalled,
				message: messageText(details.message),
				changelog: details.changelog,
				commits: details.commits,
				permissionsAdded: details.permissionsAdded,
				newMigrations: details.newMigrations,
				npmNew: details.npmNew,
				blockers: details.blockers,
				checkedAt: c?.checkedAt.toISOString() ?? null,
				latestUrl:
					src && c?.latestCommit
						? `https://github.com/${src.owner}/${src.repo}/tree/${c.latestCommit}${src.path ? `/${src.path}` : ''}`
						: null
			};
		});
}

/** Anzahl der Module mit verfügbarem Update laut letztem Prüfstand (ohne Rechteprüfung, für Kennzahlen) */
export async function availableUpdateCount(): Promise<number> {
	const db = getDb();
	const rows = await db.select().from(schema.moduleInstall);
	const checks = new Map((await db.select().from(schema.moduleUpdateCheck)).map((c) => [c.id, c]));
	let n = 0;
	for (const r of rows) {
		const c = checks.get(r.id);
		if (!c) continue;
		const { status } = statusOf(r, {
			result: c.result as CheckOutcome['result'],
			latestVersion: c.latestVersion,
			latestContentHash: c.latestContentHash,
			details: { ...EMPTY_DETAILS, ...((c.details ?? {}) as object) }
		});
		if (status === 'update' || status === 'changed') n++;
	}
	return n;
}

/** „Nach Updates suchen“ im Panel: prüfen, speichern, aktuellen Stand zurückgeben */
export async function checkUpdates(ctx: RequestContext, ids?: string[]): Promise<UpdateInfo[]> {
	await assertInstaller(ctx);
	await runUpdateCheck(ids);
	const checks = await listUpdateChecks(ctx);
	return ids ? checks.filter((check) => ids.includes(check.id)) : checks;
}

/** Wird die tägliche Prüfung ausgeführt? (nicht bei `ATRIUM_MODULE_INSTALL=off`; ohne GitHub-Module ohne Netzzugriff) */
export function updateChecksEnabled(): boolean {
	return installStatus().mode !== 'off';
}

async function installRow(id: string): Promise<InstallRow> {
	const [row] = await getDb()
		.select()
		.from(schema.moduleInstall)
		.where(eq(schema.moduleInstall.id, id));
	if (!row) throw errors.notFound(t('install.manage.notFound'));
	return row;
}

export async function setUpdateChannel(
	ctx: RequestContext,
	id: string,
	channel: UpdateChannel
): Promise<void> {
	await assertInstaller(ctx);
	const row = await installRow(id);
	if (row.sourceType !== 'github') throw errors.badRequest(t('install.updates.channelNeedsGithub'));
	await getDb()
		.update(schema.moduleInstall)
		.set({ channel: normalizeChannel(channel) })
		.where(eq(schema.moduleInstall.id, id));
	// Alter Prüfstand gilt für den anderen Kanal nicht mehr
	await getDb().delete(schema.moduleUpdateCheck).where(eq(schema.moduleUpdateCheck.id, id));
	await auditFromContext(ctx, 'core.module.update_channel', {
		target: id,
		metadata: { channel }
	});
}

/** Gefundenen Stand ignorieren (`ignore = false` hebt es auf) */
export async function ignoreUpdate(
	ctx: RequestContext,
	id: string,
	ignore: boolean
): Promise<void> {
	await assertInstaller(ctx);
	await installRow(id);
	let key: string | null = null;
	if (ignore) {
		const [c] = await getDb()
			.select()
			.from(schema.moduleUpdateCheck)
			.where(eq(schema.moduleUpdateCheck.id, id));
		if (!c?.latestVersion || !c.latestContentHash)
			throw errors.conflict(t('install.updates.nothingToIgnore'));
		key = ignoreKey(c.latestVersion, c.latestContentHash);
	}
	await getDb()
		.update(schema.moduleInstall)
		.set({ ignoredUpdate: key })
		.where(eq(schema.moduleInstall.id, id));
	await auditFromContext(
		ctx,
		ignore ? 'core.module.update_ignored' : 'core.module.update_unignored',
		{
			target: id
		}
	);
}

/** Gespeicherter Prüfstand mit neuem Commit für `previewUpdates` (nur Module mit Update) */
export async function updateTargets(
	ids: string[]
): Promise<{ id: string; owner: string; repo: string; path: string; ref: string; sha: string }[]> {
	const db = getDb();
	const out: { id: string; owner: string; repo: string; path: string; ref: string; sha: string }[] =
		[];
	for (const id of ids) {
		const row = await installRow(id);
		const src = sourceOf(row);
		const [c] = await db
			.select()
			.from(schema.moduleUpdateCheck)
			.where(eq(schema.moduleUpdateCheck.id, id));
		if (!src?.owner || !src.repo || !c?.latestCommit || !c.latestRef) {
			throw errors.conflict(t('install.updates.notChecked', { id }));
		}
		out.push({
			id,
			owner: String(src.owner),
			repo: String(src.repo),
			path: String(src.path ?? ''),
			ref: c.latestRef,
			sha: c.latestCommit
		});
	}
	return out;
}
