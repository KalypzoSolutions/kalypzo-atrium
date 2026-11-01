/**
 * Admin-Reset: ausgewählte Datenbereiche (Core und Module) zurücksetzen.
 *
 * Ablauf: `listResetAreas` → `previewReset` (Token, 15 min) → `exportResetData` (Passwort + ggf. TOTP,
 * Pflicht-Export als verschlüsselte `.epbackup`-Sicherung) → `executeReset` (Bestätigungswort). Nur Session-Benutzer mit
 * `core.system.reset`. Core-Services laufen nie innerhalb offener Modul-Transaktionen (PGlite).
 *
 * TOTP: Das Secret aus `two_factor` wird mit Better-Auths `symmetricDecrypt` (Schlüssel aus
 * `$context.secretConfig`) entschlüsselt und hier per RFC 6238 (SHA-1, 6 Stellen, 30 s, Fenster ±1)
 * geprüft – genau wie Better Auth (`@better-auth/utils/otp`). Der HTTP-Weg `verifyTOTP` ist
 * ungeeignet, weil er an Sitzungs-Cookies hängt und Sitzungen verändern kann.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, sql, type SQL } from 'drizzle-orm';
import { symmetricDecrypt } from 'better-auth/crypto';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getAuth } from '../auth';
import { systemContext } from '../auth/context';
import { verifyUserPassword } from '../auth/profile';
import { getDb, schema, type DbOrTx } from '../database/client';
import { forModule } from '../database/module-db';
import { errors } from '../errors';
import { pauseJobs, resumeJobs } from '../jobs';
import { allDefinitions, notifyModuleDataReplaced } from '../modules/registry';
import { isModuleEnabled, runModuleMigrations } from '../modules/service';
import { moduleSchemaName, type ResetArea } from '../modules/types';
import { getUserPermissions, requirePermission } from '../permissions/service';
import { hit, peek, reset as resetRateLimit } from '../rate-limit';
import { listDefinitions } from '../settings/service';
import { listPurgeCandidates, purgeUnchecked, type PurgeInput } from '../storage';
import { writeBackupFile } from '../backup/export';
import { listBackupScopes } from '../backup/scopes';
import { removeTemp } from '../backup/tempfiles';
import { BACKUP_MIN_PASSWORD } from '../backup/types';
import { acquireMaintenanceLock, releaseMaintenanceLock } from './maintenance';
import {
	areasFingerprint,
	effectiveImplies,
	moduleDeleteOrder,
	resolveAreas,
	type AreaNode
} from './reset-areas';
import { rowsOf, type Row } from '../database/rows';
import { localized, t } from '$lib/i18n';

// ---------------------------------------------------------------------------
// Öffentliche Typen
// ---------------------------------------------------------------------------

export interface ResetAreaInfo {
	/** `core:audit` oder `<modul>:<id>` */
	key: string;
	/** `Core` oder Modulname */
	group: string;
	label: string;
	description: string;
	implies: { area: string; reason: string }[];
	rebuild: boolean;
}

export interface ResetPreview {
	/** Aufgelöst inkl. implizierter Bereiche */
	areas: string[];
	implied: { area: string; by: string; reason: string }[];
	/** `table` = `schema.table` */
	tables: { area: string; table: string; rows: number }[];
	files: { module: string; count: number; bytes: number }[];
	token: string;
	expiresAt: string;
}

/** Deutsches Bestätigungswort – wird in jeder Sprache zusätzlich angenommen (Tests, Gewohnheit) */
export const RESET_CONFIRM_WORD = 'ZURÜCKSETZEN';

/** Bestätigungswort in der aktuellen Sprache (Anzeige und Prüfung) */
export function resetConfirmWord(): string {
	return t('reset.confirmWord');
}

/** Eingabe = Wort der aktuellen Sprache oder das deutsche Wort */
export function isResetConfirmWord(input: string): boolean {
	return input === resetConfirmWord() || input === RESET_CONFIRM_WORD;
}

export interface ResetResult {
	areas: string[];
	deletedRows: number;
	deletedFiles: number;
	warnings: string[];
}

/** Einstellungen, die `core:settings` bewusst erhält (Zugangsdaten für Speicher und Mail). */
export const RESET_PROTECTED_SETTING_PREFIXES = ['core.storage.', 'core.smtp.'];

// ---------------------------------------------------------------------------
// Core-Bereiche
// ---------------------------------------------------------------------------

interface CoreTable {
	table: string;
	where?: (keep: string) => SQL;
	/** Spalten für den Export (Standard: alle) */
	columns?: string[];
	/** Wird per Fremdschlüssel-Kaskade mitgelöscht (nur Vorschau/Export) */
	cascade?: boolean;
}

interface CoreAreaDef {
	id: string;
	label: string;
	description: string;
	implies?: { area: string; reason: string }[];
	tables: CoreTable[];
}

const USER_COLUMNS = [
	'id',
	'name',
	'email',
	'email_verified',
	'image',
	'active',
	'two_factor_enabled',
	'created_at',
	'updated_at'
];
const API_KEY_COLUMNS = [
	'id',
	'name',
	'prefix',
	'scopes',
	'owner_id',
	'expires_at',
	'revoked_at',
	'last_used_at',
	'created_at'
];

/** Geschützte Einstellungen: Speicher-/SMTP-Zugang sowie alle als Secret markierten Schlüssel. */
export function protectedSettingKeys(): string[] {
	return listDefinitions()
		.filter((d) => d.secret || RESET_PROTECTED_SETTING_PREFIXES.some((p) => d.key.startsWith(p)))
		.map((d) => d.key);
}

function settingsWhere(): SQL {
	const parts: SQL[] = RESET_PROTECTED_SETTING_PREFIXES.map(
		(p) => sql`key NOT LIKE ${p.replace(/[\\%_]/g, (c) => `\\${c}`) + '%'}`
	);
	const keys = protectedSettingKeys();
	if (keys.length) {
		parts.push(
			sql`key NOT IN (${sql.join(
				keys.map((k) => sql`${k}`),
				sql`, `
			)})`
		);
	}
	return sql.join(parts, sql` AND `);
}

const NON_SYSTEM_ROLE_IDS = sql`SELECT id FROM "public"."role" WHERE NOT is_system`;

/** `label`/`description`/`reason` sind Textschlüssel (Übersetzung in `collectAreas`) */
const CORE_AREAS: CoreAreaDef[] = [
	{
		id: 'api-keys',
		label: 'reset.area.apiKeys.label',
		description: 'reset.area.apiKeys.description',
		tables: [{ table: 'api_key', columns: API_KEY_COLUMNS }]
	},
	{
		id: 'users',
		label: 'reset.area.users.label',
		description: 'reset.area.users.description',
		implies: [{ area: 'core:api-keys', reason: 'reset.area.users.impliesApiKeys' }],
		tables: [
			{ table: 'setting', where: (keep) => sql`scope_id <> '' AND scope_id <> ${keep}` },
			{ table: 'user_role', where: (keep) => sql`user_id <> ${keep}`, cascade: true },
			{ table: 'user_role_grant', where: (keep) => sql`user_id <> ${keep}`, cascade: true },
			{ table: 'user_permission', where: (keep) => sql`user_id <> ${keep}`, cascade: true },
			{ table: 'notification_pref', where: (keep) => sql`user_id <> ${keep}`, cascade: true },
			{ table: 'push_subscription', where: (keep) => sql`user_id <> ${keep}`, cascade: true },
			{ table: 'notification_queue', where: (keep) => sql`user_id <> ${keep}`, cascade: true },
			{ table: 'user', where: (keep) => sql`id <> ${keep}`, columns: USER_COLUMNS }
		]
	},
	{
		id: 'roles',
		label: 'reset.area.roles.label',
		description: 'reset.area.roles.description',
		tables: [
			{
				table: 'role_grant_applied',
				where: () => sql`role_name NOT IN (SELECT name FROM "public"."role" WHERE is_system)`
			},
			{ table: 'user_role', where: () => sql`role_id IN (${NON_SYSTEM_ROLE_IDS})`, cascade: true },
			{
				table: 'user_role_grant',
				where: () => sql`role_id IN (${NON_SYSTEM_ROLE_IDS})`,
				cascade: true
			},
			{
				table: 'role_permission',
				where: () => sql`role_id IN (${NON_SYSTEM_ROLE_IDS})`,
				cascade: true
			},
			{ table: 'role', where: () => sql`NOT is_system` }
		]
	},
	{
		id: 'api-log',
		label: 'reset.area.apiLog.label',
		description: 'reset.area.apiLog.description',
		tables: [{ table: 'api_log' }]
	},
	{
		id: 'jobs',
		label: 'reset.area.jobs.label',
		description: 'reset.area.jobs.description',
		tables: [{ table: 'job_run' }]
	},
	{
		id: 'ai-usage',
		label: 'reset.area.aiUsage.label',
		description: 'reset.area.aiUsage.description',
		tables: [{ table: 'ai_usage' }]
	},
	{
		id: 'settings',
		label: 'reset.area.settings.label',
		description: 'reset.area.settings.description',
		tables: [{ table: 'setting', where: () => settingsWhere() }]
	},
	{
		id: 'audit',
		label: 'reset.area.audit.label',
		description: 'reset.area.audit.description',
		tables: [{ table: 'audit_log' }]
	}
];

// ---------------------------------------------------------------------------
// Bereichskatalog
// ---------------------------------------------------------------------------

interface AreaDef {
	node: AreaNode;
	info: ResetAreaInfo;
	core?: CoreAreaDef;
	moduleArea?: ResetArea;
}

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;
const AREA_ID = /^[a-z][a-z0-9-]*$/;

/** Aktive Module in Löschreihenfolge (abhängige zuerst). */
async function activeModulesInOrder() {
	const defs = [];
	for (const d of allDefinitions()) if (await isModuleEnabled(d.manifest.id)) defs.push(d);
	const order = moduleDeleteOrder(
		defs.map((d) => ({
			id: d.manifest.id,
			deps: [...d.manifest.dependencies, ...(d.manifest.optionalDependencies ?? [])]
		}))
	);
	const byId = new Map(defs.map((d) => [d.manifest.id, d]));
	return order.map((id) => byId.get(id)!);
}

async function collectAreas(): Promise<AreaDef[]> {
	const out: AreaDef[] = [];
	for (const def of await activeModulesInOrder()) {
		const id = def.manifest.id;
		for (const a of def.resetAreas ?? []) {
			if (!AREA_ID.test(a.id)) continue;
			const key = `${id}:${a.id}`;
			out.push({
				node: { key, module: id, rebuild: !!a.rebuild, implies: a.implies ?? [] },
				info: {
					key,
					group: localized(def.manifest.name),
					label: localized(a.label),
					description: localized(a.description),
					implies: [],
					rebuild: !!a.rebuild
				},
				moduleArea: a
			});
		}
	}
	for (const c of CORE_AREAS) {
		const key = `core:${c.id}`;
		out.push({
			node: {
				key,
				module: 'core',
				rebuild: false,
				implies: (c.implies ?? []).map((i) => ({ area: i.area, reason: t(i.reason) }))
			},
			info: {
				key,
				group: t('reset.coreGroup'),
				label: t(c.label),
				description: t(c.description),
				implies: [],
				rebuild: false
			},
			core: c
		});
	}
	const nodes = out.map((a) => a.node);
	for (const a of out) a.info.implies = effectiveImplies(a.node, nodes);
	return out;
}

// ---------------------------------------------------------------------------
// Zugriff und Token
// ---------------------------------------------------------------------------

async function requireResetUser(ctx: RequestContext): Promise<string> {
	await requirePermission(ctx, 'core.system.reset');
	if (ctx.actor.type !== 'user' || !ctx.userId) {
		throw errors.forbidden(t('reset.onlyUsers'));
	}
	return ctx.userId;
}

const TOKEN_TTL_MS = 15 * 60_000;

interface TokenEntry {
	userId: string;
	selected: string[];
	areas: string[];
	fingerprint: string;
	status: 'previewed' | 'exported';
	expiresAt: number;
}

const tokens = new Map<string, TokenEntry>();
let clock: () => number = () => Date.now();

/** Nur für Tests: verschobene Uhr (Token-Ablauf) */
export function setResetClockForTests(fn: (() => number) | undefined): void {
	clock = fn ?? (() => Date.now());
}

function sweepTokens(): void {
	const now = clock();
	for (const [k, v] of tokens) if (v.expiresAt <= now) tokens.delete(k);
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function requireToken(token: string, userId: string): TokenEntry {
	sweepTokens();
	const entry = typeof token === 'string' ? tokens.get(hashToken(token)) : undefined;
	if (!entry || entry.userId !== userId) {
		throw errors.conflict(t('reset.previewExpired'));
	}
	return entry;
}

// ---------------------------------------------------------------------------
// Datenbank-Helfer
// ---------------------------------------------------------------------------

const qualified = (schemaName: string, table: string) =>
	sql.raw(`"${schemaName}"."${table.replace(/"/g, '')}"`);

/** Existierende Tabellen eines Schemas */
async function schemaTables(schemaName: string): Promise<string[]> {
	const rows = await rowsOf(
		getDb(),
		sql`SELECT table_name FROM information_schema.tables
			WHERE table_schema = ${schemaName} AND table_type = 'BASE TABLE' ORDER BY table_name`
	);
	return rows.map((r) => String(r.table_name));
}

interface PlannedTable {
	area: string;
	schemaName: string;
	table: string;
	where?: SQL;
	columns?: string[];
	cascade?: boolean;
}

/** Tabellen je aufgelöstem Bereich (Module: deklarierte bzw. bei `rebuild` alle vorhandenen). */
async function planTables(areas: AreaDef[], keep: string): Promise<PlannedTable[]> {
	const out: PlannedTable[] = [];
	const cache = new Map<string, string[]>();
	for (const a of areas) {
		if (a.core) {
			for (const t of a.core.tables) {
				out.push({
					area: a.node.key,
					schemaName: 'public',
					table: t.table,
					where: t.where?.(keep),
					columns: t.columns,
					cascade: t.cascade
				});
			}
			continue;
		}
		const schemaName = moduleSchemaName(a.node.module);
		if (!cache.has(schemaName)) cache.set(schemaName, await schemaTables(schemaName));
		const existing = cache.get(schemaName)!;
		const wanted = a.node.rebuild
			? existing
			: (a.moduleArea?.tables ?? []).filter((t) => TABLE_NAME.test(t) && existing.includes(t));
		for (const table of wanted) out.push({ area: a.node.key, schemaName, table });
	}
	return out;
}

async function countRows(t: PlannedTable): Promise<number> {
	const where = t.where ? sql` WHERE ${t.where}` : sql``;
	const [r] = await rowsOf(
		getDb(),
		sql`SELECT count(*)::int AS n FROM ${qualified(t.schemaName, t.table)}${where}`
	);
	return Number(r?.n ?? 0);
}

/** Storage-Löschaufträge der aufgelösten Bereiche (je Modul zusammengefasst). */
function planStorage(areas: AreaDef[], keep: string): PurgeInput[] {
	const byModule = new Map<string, Set<string>>();
	for (const a of areas) {
		const p = a.moduleArea?.storagePrefixes;
		if (!p) continue;
		const set = byModule.get(a.node.module) ?? new Set<string>();
		if (p === 'all') set.add('');
		else for (const x of p) if (typeof x === 'string') set.add(x.replace(/^\/+/, ''));
		byModule.set(a.node.module, set);
	}
	const out: PurgeInput[] = [];
	for (const [module, set] of byModule) {
		const list = [...set].sort((x, y) => x.length - y.length);
		const kept: string[] = [];
		for (const p of list) if (!kept.some((k) => p.startsWith(k))) kept.push(p);
		for (const prefix of kept) out.push({ module, prefix });
	}
	if (areas.some((a) => a.node.key === 'core:users')) {
		out.push({ module: 'core', prefix: 'avatars/', exceptPaths: [`avatars/${keep}`] });
	}
	return out;
}

async function storageCandidates(plan: PurgeInput[]) {
	const byModule = new Map<string, Map<string, { size: number; row: Row }>>();
	for (const p of plan) {
		const rows = await listPurgeCandidates(p);
		const m = byModule.get(p.module) ?? new Map();
		for (const r of rows) {
			m.set(r.id, {
				size: Number(r.size || 0),
				row: {
					id: r.id,
					module_id: r.moduleId,
					path: r.path,
					name: r.name,
					size: r.size,
					content_type: r.contentType,
					status: r.status,
					created_by: r.createdBy,
					created_at: r.createdAt
				}
			});
		}
		byModule.set(p.module, m);
	}
	return byModule;
}

/** Erneute Auflösung für einen Token; jede Abweichung (z. B. Modul deaktiviert) → 409 */
async function reresolve(entry: TokenEntry, token: string) {
	try {
		const resolved = await resolveSelection(entry.selected);
		if (areasFingerprint(resolved.areas) === entry.fingerprint) return resolved;
	} catch {
		// unten einheitlich behandeln
	}
	tokens.delete(hashToken(token));
	throw errors.conflict(t('reset.previewExpired'));
}

async function resolveSelection(selected: string[]) {
	if (!Array.isArray(selected) || !selected.length) {
		throw errors.validation([{ path: ['areas'], message: t('reset.chooseArea') }]);
	}
	const all = await collectAreas();
	const res = resolveAreas(
		selected.map((s) => String(s)),
		all.map((a) => a.node)
	);
	if (res.unknown.length) {
		throw errors.validation([
			{ path: ['areas'], message: t('reset.unknownAreas', { areas: res.unknown.join(', ') }) }
		]);
	}
	const set = new Set(res.areas);
	return { ...res, defs: all.filter((a) => set.has(a.node.key)) };
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238)
// ---------------------------------------------------------------------------

/** TOTP-Code wie Better Auth (HMAC-SHA1 mit dem UTF-8-Secret, 6 Stellen, 30 s) */
export function totpCode(secret: string, atMs: number = Date.now(), offset = 0): string {
	const counter = Math.floor(atMs / 30_000) + offset;
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64BE(BigInt(counter));
	const h = createHmac('sha1', Buffer.from(secret, 'utf8')).update(buf).digest();
	const o = h[h.length - 1]! & 15;
	const n =
		((h[o]! & 127) << 24) |
		((h[o + 1]! & 255) << 16) |
		((h[o + 2]! & 255) << 8) |
		(h[o + 3]! & 255);
	return String(n % 1_000_000).padStart(6, '0');
}

export async function verifyTotp(userId: string, code: string): Promise<boolean> {
	if (!/^\d{6}$/.test(code)) return false;
	const [tf] = await getDb()
		.select({ secret: schema.twoFactor.secret })
		.from(schema.twoFactor)
		.where(eq(schema.twoFactor.userId, userId));
	if (!tf) return false;
	let secret: string;
	try {
		const authCtx = await getAuth().$context;
		secret = await symmetricDecrypt({ key: authCtx.secretConfig, data: tf.secret });
	} catch {
		return false;
	}
	const now = Date.now();
	let ok = false;
	for (const off of [-1, 0, 1]) {
		const expected = Buffer.from(totpCode(secret, now, off));
		ok = timingSafeEqual(expected, Buffer.from(code)) || ok;
	}
	return ok;
}

const TOTP_WINDOW_SEC = 10 * 60;
const TOTP_MAX_FAILURES = 5;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Verfügbare Bereiche (Core + aktive Module). */
export async function listResetAreas(ctx: RequestContext): Promise<ResetAreaInfo[]> {
	await requireResetUser(ctx);
	return (await collectAreas()).map((a) => a.info);
}

/** Vorschau mit Zeilen-/Dateizählern und Token (15 min). */
export async function previewReset(ctx: RequestContext, areaKeys: string[]): Promise<ResetPreview> {
	const userId = await requireResetUser(ctx);
	const resolved = await resolveSelection(areaKeys);
	const planned = await planTables(resolved.defs, userId);
	const tables: ResetPreview['tables'] = [];
	for (const t of planned) {
		tables.push({ area: t.area, table: `${t.schemaName}.${t.table}`, rows: await countRows(t) });
	}
	const files = [...(await storageCandidates(planStorage(resolved.defs, userId)))].map(
		([module, m]) => ({
			module,
			count: m.size,
			bytes: [...m.values()].reduce((s, f) => s + f.size, 0)
		})
	);
	const token = randomBytes(24).toString('base64url');
	const expiresAt = clock() + TOKEN_TTL_MS;
	sweepTokens();
	tokens.set(hashToken(token), {
		userId,
		selected: [...new Set(areaKeys.map(String))],
		areas: resolved.areas,
		fingerprint: areasFingerprint(resolved.areas),
		status: 'previewed',
		expiresAt
	});
	return {
		areas: resolved.areas,
		implied: resolved.implied,
		tables,
		files,
		token,
		expiresAt: new Date(expiresAt).toISOString()
	};
}

/** Mindestlänge des Passworts für die verschlüsselte Sicherung (wie bei der Datensicherung) */
export const RESET_EXPORT_MIN_PASSWORD = BACKUP_MIN_PASSWORD;

/** Reset-Bereich → Bereich der Datensicherung (`core:<id>` gleich, `<modul>:<id>` → ganzes Modul). */
export function backupScopesForResetAreas(areas: string[]): string[] {
	const out = new Set<string>();
	for (const a of areas) out.add(a.startsWith('core:') ? a : a.slice(0, a.indexOf(':')));
	return [...out];
}

export interface ResetExport {
	fileName: string;
	/** Temp-Datei (`.epbackup`); nach dem Senden mit `done()` löschen */
	path: string;
	size: number;
	done(): Promise<void>;
}

/**
 * Pflicht-Export vor dem Zurücksetzen nach Passwort-(und TOTP-)Prüfung (#29): verschlüsselte Sicherung im
 * Format der Datensicherung (`.epbackup`, scrypt + AES-256-GCM, Passwort `backupPassword` ≥ 12 Zeichen)
 * mit den **ganzen** Bereichen/Modulen der Auswahl (Teil-Bereiche eines Moduls → ganzes Modul, Dateien
 * ohne Inhalte). Wiederherstellbar über `/admin/backup` (Import). Kein Klartext-JSON mehr.
 */
export async function exportResetData(
	ctx: RequestContext,
	input: { token: string; password: string; totp?: string; backupPassword: string }
): Promise<ResetExport> {
	const userId = await requireResetUser(ctx);
	const entry = requireToken(input.token, userId);
	const backupPassword = String(input.backupPassword ?? '');
	if (backupPassword.length < BACKUP_MIN_PASSWORD || backupPassword.length > 200) {
		throw errors.validation([
			{
				path: ['backupPassword'],
				message: t('reset.backupPasswordMin', { count: BACKUP_MIN_PASSWORD })
			}
		]);
	}
	if (!(await verifyUserPassword(userId, String(input.password ?? '')))) {
		throw errors.validation([{ path: ['password'], message: t('maintenance.wrongPassword') }]);
	}
	const [u] = await getDb()
		.select({ twoFactorEnabled: schema.user.twoFactorEnabled })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (u?.twoFactorEnabled) {
		const key = `resettotp:${userId}`;
		if (peek(key, TOTP_WINDOW_SEC) >= TOTP_MAX_FAILURES) {
			throw errors.badRequest(t('maintenance.tooManyAttempts'));
		}
		const code = String(input.totp ?? '').replace(/\s+/g, '');
		if (!(await verifyTotp(userId, code))) {
			hit(key, 1000, TOTP_WINDOW_SEC);
			throw errors.validation([{ path: ['totp'], message: t('maintenance.totpInvalid') }]);
		}
		resetRateLimit(key);
	}
	const resolved = await reresolve(entry, input.token);
	const known = new Set((await listBackupScopes()).map((s) => s.key));
	const scopes = backupScopesForResetAreas(resolved.areas).filter((s) => known.has(s));
	if (!scopes.length) throw errors.badRequest(t('reset.noData'));
	const built = await writeBackupFile(
		userId,
		{ scopes, includeFiles: false, backupPassword },
		'maintenance.lock.resetExport'
	);
	entry.status = 'exported';
	await auditFromContext(ctx, 'core.system.reset_exported', {
		metadata: {
			areas: resolved.areas,
			scopes,
			tables: built.summary.tables,
			rows: built.summary.rows,
			encrypted: true
		}
	});
	return {
		fileName: built.fileName.startsWith(`${t('backup.export.fileNamePrefix')}-`)
			? `atrium-reset-${built.fileName.slice(t('backup.export.fileNamePrefix').length + 1)}`
			: built.fileName,
		path: built.path,
		size: built.summary.bytes,
		done: () => removeTemp(built.path)
	};
}

async function deleteCount(db: DbOrTx, table: SQL, where?: SQL): Promise<number> {
	const w = where ? sql` WHERE ${where}` : sql``;
	const [r] = await rowsOf(
		db,
		sql`WITH d AS (DELETE FROM ${table}${w} RETURNING 1) SELECT count(*)::int AS n FROM d`
	);
	return Number(r?.n ?? 0);
}

/** Führt den Reset aus (nur nach Export, Bestätigungswort exakt). */
export async function executeReset(
	ctx: RequestContext,
	input: { token: string; confirmWord: string }
): Promise<ResetResult> {
	const userId = await requireResetUser(ctx);
	const entry = requireToken(input.token, userId);
	if (entry.status !== 'exported') {
		throw errors.conflict(t('reset.exportFirst'));
	}
	if (!isResetConfirmWord(String(input.confirmWord ?? ''))) {
		throw errors.validation([
			{ path: ['confirmWord'], message: t('reset.typeExactly', { word: resetConfirmWord() }) }
		]);
	}
	const resolved = await reresolve(entry, input.token);
	acquireMaintenanceLock('maintenance.lock.reset');
	tokens.delete(hashToken(input.token));

	pauseJobs();
	const result: ResetResult = {
		areas: resolved.areas,
		deletedRows: 0,
		deletedFiles: 0,
		warnings: []
	};
	let failure: unknown;
	try {
		await runReset(resolved.defs, userId, result);
	} catch (e) {
		failure = e;
	} finally {
		await notifyModuleDataReplaced();
		resumeJobs();
		releaseMaintenanceLock();
	}
	await auditFromContext(ctx, 'core.system.reset', {
		metadata: {
			areas: result.areas,
			deletedRows: result.deletedRows,
			deletedFiles: result.deletedFiles,
			warnings: result.warnings.length,
			...(failure ? { failed: true } : {})
		}
	});
	if (failure) throw failure;
	return result;
}

async function runReset(defs: AreaDef[], keep: string, result: ResetResult): Promise<void> {
	const keys = new Set(defs.map((d) => d.node.key));
	const planned = await planTables(defs, keep);

	// 1) Module (abhängige zuerst – defs folgen der Modulreihenfolge aus collectAreas)
	const modules = [...new Set(defs.filter((d) => !d.core).map((d) => d.node.module))];
	for (const moduleId of modules) {
		const schemaName = moduleSchemaName(moduleId);
		const mine = defs.filter((d) => d.node.module === moduleId);
		if (mine.some((d) => d.node.rebuild)) {
			let rows = 0;
			for (const table of await schemaTables(schemaName)) {
				rows += await countRows({ area: '', schemaName, table });
			}
			await getDb().transaction(async (tx) => {
				await tx.execute(sql.raw(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`));
				await tx
					.delete(schema.moduleMigration)
					.where(eq(schema.moduleMigration.moduleId, moduleId));
				// Vom Modul verliehene Rollen hängen an den gelöschten Daten (z. B. Ämter)
				await tx.delete(schema.userRoleGrant).where(eq(schema.userRoleGrant.moduleId, moduleId));
				await runModuleMigrations(moduleId, tx);
			});
			result.deletedRows += rows;
			continue;
		}
		const tables = [
			...new Set(planned.filter((t) => t.schemaName === schemaName).map((t) => t.table))
		];
		if (!tables.length) continue;
		result.deletedRows += await forModule(moduleId).transaction(async (tx) => {
			let n = 0;
			for (const t of tables) n += await deleteCount(tx, sql.raw(`"${t}"`));
			return n;
		});
	}

	// 2) Benutzerverweise in allen aktiven Modulen bereinigen
	if (keys.has('core:users')) {
		for (const def of await activeModulesInOrder()) {
			if (!def.resetUsers) continue;
			await forModule(def.manifest.id).transaction((tx) => def.resetUsers!(tx, keep));
		}
	}

	// 3) Core-Tabellen (ohne Einstellungen und Audit)
	const coreOrder = [
		'core:api-keys',
		'core:users',
		'core:roles',
		'core:api-log',
		'core:jobs',
		'core:ai-usage'
	];
	const runCore = async (area: string, audit = false) => {
		const list = planned.filter((t) => t.area === area && !t.cascade);
		if (!list.length) return;
		result.deletedRows += await getDb().transaction(async (tx) => {
			if (audit) await tx.execute(sql.raw(`SET LOCAL app.audit_reset = 'on'`));
			let n = 0;
			for (const t of list) n += await deleteCount(tx, qualified(t.schemaName, t.table), t.where);
			return n;
		});
	};
	for (const area of coreOrder) if (keys.has(area)) await runCore(area);

	// 4) Dateien (außerhalb jeder Transaktion)
	for (const p of planStorage(defs, keep)) {
		const r = await purgeUnchecked(systemContext('reset'), p, { audit: false });
		result.deletedFiles += r.count;
		result.warnings.push(...r.warnings);
	}

	// 5) Einstellungen, zuletzt Audit
	if (keys.has('core:settings')) await runCore('core:settings');
	if (keys.has('core:audit')) await runCore('core:audit', true);

	if (keys.has('core:roles') || keys.has('core:users')) {
		const perms = await getUserPermissions(keep);
		if (!perms.has('core.system.reset')) {
			result.warnings.push(t('reset.lostAdmin'));
		}
	}
}
