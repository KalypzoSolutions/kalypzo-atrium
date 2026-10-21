import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core';

const id = () => text('id').primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Better Auth (Tabellennamen/Felder gemäß Better-Auth-Schema)
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
	id: id(),
	name: text('name').notNull(),
	email: text('email').notNull().unique(),
	emailVerified: boolean('email_verified').notNull().default(false),
	image: text('image'),
	/** Deaktivierte Benutzer können sich nicht anmelden; Sessions werden widerrufen. */
	active: boolean('active').notNull().default(true),
	twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
	createdAt: createdAt(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const session = pgTable(
	'session',
	{
		id: id(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		token: text('token').notNull().unique(),
		createdAt: createdAt(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' })
	},
	(t) => [index('session_user_idx').on(t.userId)]
);

export const account = pgTable(
	'account',
	{
		id: id(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
		scope: text('scope'),
		password: text('password'),
		createdAt: createdAt(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('account_user_idx').on(t.userId)]
);

export const verification = pgTable('verification', {
	id: id(),
	identifier: text('identifier').notNull(),
	value: text('value').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	createdAt: createdAt(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const twoFactor = pgTable('two_factor', {
	id: id(),
	secret: text('secret').notNull(),
	backupCodes: text('backup_codes').notNull(),
	verified: boolean('verified').default(true),
	failedVerificationCount: integer('failed_verification_count').default(0),
	lockedUntil: timestamp('locked_until', { withTimezone: true }),
	userId: text('user_id')
		.notNull()
		.references(() => user.id, { onDelete: 'cascade' })
});

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

/** Registrierte Berechtigungen (Core + Module). Quelle der Wahrheit sind die Manifeste. */
export const permission = pgTable('permission', {
	key: text('key').primaryKey(),
	moduleId: text('module_id').notNull(),
	description: text('description'),
	createdAt: createdAt()
});

export const role = pgTable('role', {
	id: id(),
	name: text('name').notNull().unique(),
	description: text('description'),
	/** Systemrollen (z. B. Administrator) sind nicht lösch- und nicht umbenennbar. */
	isSystem: boolean('is_system').notNull().default(false),
	/**
	 * Stabile Kennung vom Core angelegter Rollen (`default:<Name>` für `defaultRoleGrants`, Migration 0008).
	 * Modulrechte gehen nur an die Rolle mit dieser Kennung, nie an eine bloß gleichnamige.
	 */
	systemKey: text('system_key').unique(),
	createdAt: createdAt(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const rolePermission = pgTable(
	'role_permission',
	{
		roleId: text('role_id')
			.notNull()
			.references(() => role.id, { onDelete: 'cascade' }),
		permissionKey: text('permission_key')
			.notNull()
			.references(() => permission.key, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })]
);

export const userRole = pgTable(
	'user_role',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		roleId: text('role_id')
			.notNull()
			.references(() => role.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.userId, t.roleId] })]
);

/**
 * Einzelne Berechtigungen, die direkt an einem Benutzer hängen (zusätzlich zu seinen Rollen).
 * Wirksam nur für Core-Rechte und Rechte aktiver Module (siehe `getUserPermissions`).
 */
export const userPermission = pgTable(
	'user_permission',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		permissionKey: text('permission_key')
			.notNull()
			.references(() => permission.key, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.userId, t.permissionKey] })]
);

/**
 * Rollen, die ein Modul verleiht (z. B. `offices` über Ämter). Getrennt von `user_role`,
 * damit manuelle Zuweisungen unberührt bleiben; wirksam nur bei aktivem Modul.
 */
export const userRoleGrant = pgTable(
	'user_role_grant',
	{
		userId: text('user_id').notNull(),
		roleId: text('role_id').notNull(),
		moduleId: text('module_id').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	// Namen wie in drizzle/0006_user_role_grant.sql (Inline-REFERENCES → Postgres-Standardnamen `_fkey`)
	(t) => [
		primaryKey({ name: 'user_role_grant_pk', columns: [t.userId, t.roleId, t.moduleId] }),
		foreignKey({
			name: 'user_role_grant_user_id_fkey',
			columns: [t.userId],
			foreignColumns: [user.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'user_role_grant_role_id_fkey',
			columns: [t.roleId],
			foreignColumns: [role.id]
		}).onDelete('cascade'),
		index('user_role_grant_module_idx').on(t.moduleId)
	]
);

/**
 * Marker für einmalig nachgezogene Standard-Rechte (`ModuleDefinition.defaultRoleGrants`):
 * bewusst entzogene Rechte kommen dadurch nicht zurück.
 */
export const roleGrantApplied = pgTable(
	'role_grant_applied',
	{
		moduleId: text('module_id').notNull(),
		roleName: text('role_name').notNull(),
		permissionKey: text('permission_key').notNull(),
		appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({
			name: 'role_grant_applied_pk',
			columns: [t.moduleId, t.roleName, t.permissionKey]
		})
	]
);

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

export const moduleState = pgTable('module_state', {
	id: id(),
	enabled: boolean('enabled').notNull().default(false),
	installedVersion: text('installed_version').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const moduleMigration = pgTable(
	'module_migration',
	{
		moduleId: text('module_id').notNull(),
		name: text('name').notNull(),
		checksum: text('checksum').notNull(),
		appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.moduleId, t.name] })]
);

/** Letzter Lauf je Hintergrundjob (`<modul>.<job>`); dient zugleich als Sperre gegen Doppel-Läufe */
export const jobRun = pgTable('job_run', {
	key: text('key').primaryKey(),
	lastStartedAt: timestamp('last_started_at', { withTimezone: true }).notNull(),
	lastFinishedAt: timestamp('last_finished_at', { withTimezone: true }),
	lastStatus: text('last_status'),
	lastMessage: text('last_message')
});

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

export const setting = pgTable(
	'setting',
	{
		key: text('key').notNull(),
		/** '' für globale Einstellungen, sonst Benutzer-ID */
		scopeId: text('scope_id').notNull().default(''),
		/** JSON-Wert; Secrets liegen als `enc:v1:`-String vor */
		value: jsonb('value').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		updatedBy: text('updated_by')
	},
	(t) => [primaryKey({ columns: [t.key, t.scopeId] })]
);

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export const apiKey = pgTable(
	'api_key',
	{
		id: id(),
		name: text('name').notNull(),
		/** Erste Zeichen zur Identifikation, z. B. `epk_ab12cd34` */
		prefix: text('prefix').notNull(),
		/** SHA-256 des vollständigen Schlüssels (Schlüssel hat hohe Entropie) */
		hash: text('hash').notNull(),
		scopes: text('scopes')
			.array()
			.notNull()
			.default(sql`'{}'::text[]`),
		ownerId: text('owner_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		expiresAt: timestamp('expires_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('api_key_hash_idx').on(t.hash), index('api_key_owner_idx').on(t.ownerId)]
);

export const apiLog = pgTable(
	'api_log',
	{
		id: id(),
		requestId: text('request_id').notNull(),
		method: text('method').notNull(),
		path: text('path').notNull(),
		status: integer('status').notNull(),
		durationMs: integer('duration_ms').notNull(),
		actorType: text('actor_type').notNull(),
		actorId: text('actor_id'),
		apiKeyId: text('api_key_id'),
		ip: text('ip'),
		createdAt: createdAt()
	},
	(t) => [index('api_log_created_idx').on(t.createdAt)]
);

// ---------------------------------------------------------------------------
// Audit (append-only; UPDATE/DELETE per DB-Trigger verhindert, Ausnahmen: Reset 0005, Aufbewahrung 0007)
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
	'audit_log',
	{
		id: id(),
		action: text('action').notNull(),
		actorType: text('actor_type').notNull(),
		actorId: text('actor_id'),
		actorName: text('actor_name'),
		target: text('target'),
		ip: text('ip'),
		requestId: text('request_id'),
		metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
		createdAt: createdAt()
	},
	(t) => [
		index('audit_log_created_idx').on(t.createdAt),
		index('audit_log_action_idx').on(t.action),
		index('audit_log_actor_idx').on(t.actorId),
		// Migration 0007: Verlauf je Objekt und Präfixfilter auf Aktionen
		index('audit_log_target_idx').on(t.target, t.createdAt.desc()),
		index('audit_log_action_pattern_idx').on(t.action.op('text_pattern_ops'))
	]
);

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const file = pgTable(
	'file',
	{
		id: id(),
		moduleId: text('module_id').notNull(),
		/** Virtueller Pfad innerhalb des Modulbereichs, z. B. `documents/a.pdf` */
		path: text('path').notNull(),
		name: text('name').notNull(),
		objectKey: text('object_key').notNull().unique(),
		size: bigint('size', { mode: 'number' }).notNull(),
		contentType: text('content_type').notNull(),
		checksum: text('checksum'),
		/** Pending = signierter Upload ausgegeben, noch nicht bestätigt */
		status: text('status', { enum: ['pending', 'ready'] })
			.notNull()
			.default('ready'),
		createdBy: text('created_by'),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('file_module_path_idx').on(t.moduleId, t.path)]
);

// ---------------------------------------------------------------------------
// KI-Nutzung
// ---------------------------------------------------------------------------

export const aiUsage = pgTable(
	'ai_usage',
	{
		id: id(),
		moduleId: text('module_id').notNull(),
		model: text('model').notNull(),
		inputTokens: integer('input_tokens').notNull(),
		outputTokens: integer('output_tokens').notNull(),
		costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull(),
		actorId: text('actor_id'),
		createdAt: createdAt()
	},
	(t) => [index('ai_usage_module_created_idx').on(t.moduleId, t.createdAt)]
);
