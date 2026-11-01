/**
 * Datenauskunft (Art. 15 DSGVO) und Datenübertragbarkeit (Art. 20): trägt alle Daten einer Person
 * (Benutzerkonto und/oder Mitglieder) aus dem Core und allen aktiven Modulen mit `subjectExport`
 * zu einem JSON-Dokument zusammen. Recht `core.privacy.export`, nur angemeldete Benutzer*innen.
 *
 * Ablauf: Kennungen auflösen (`resolve`, z. B. `members` ergänzt verknüpfte Mitglieder) → Core-Teil →
 * `run` je Modul (nacheinander, nie in einer offenen Transaktion; Fehler eines Moduls landen in
 * `errors`, der Rest wird trotzdem geliefert) → Audit `core.privacy.exported` (nur IDs/Zähler).
 */
import { desc, eq, ilike, inArray, or } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import type { DataSubject, SubjectCandidate } from '../modules/types';
import { allDefinitions } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';
import { directPermissionsOfUser, requirePermission } from '../permissions/service';
import { localized, t } from '$lib/i18n';

export const PRIVACY_PERMISSION = 'core.privacy.export';
/** Höchstzahl Audit-Einträge im Export (neueste zuerst) */
const MAX_AUDIT = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PrivacyCandidate extends SubjectCandidate {
	/** Quelle: `core` (Benutzerkonto) oder Modul-ID */
	source: string;
	sourceName: string;
}

export interface SubjectExport {
	format: 'atrium-datenauskunft';
	version: 1;
	generatedAt: string;
	subject: DataSubject;
	core: Record<string, unknown> | null;
	modules: Record<string, { name: string; data: Record<string, unknown> }>;
	/** Module, deren Beitrag fehlgeschlagen ist (Export ist dann unvollständig) */
	errors: { module: string; message: string }[];
}

async function requirePrivacyUser(ctx: RequestContext): Promise<void> {
	await requirePermission(ctx, PRIVACY_PERMISSION);
	if (ctx.actor.type !== 'user' || !ctx.userId) {
		throw errors.forbidden(t('privacy.signedInOnly'));
	}
}

async function activeExporters() {
	const out = [];
	for (const def of allDefinitions()) {
		if (!def.subjectExport) continue;
		if (!(await isModuleEnabled(def.manifest.id))) continue;
		out.push({
			id: def.manifest.id,
			name: localized(def.manifest.name),
			hooks: def.subjectExport
		});
	}
	return out;
}

const iso = (v: unknown): string | null =>
	v == null ? null : new Date(v instanceof Date ? v : String(v)).toISOString();

/** Personen suchen: Benutzerkonten (auch deaktivierte) + Treffer der Module (z. B. Mitglieder) */
export async function findPrivacySubjects(
	ctx: RequestContext,
	query: string
): Promise<PrivacyCandidate[]> {
	await requirePrivacyUser(ctx);
	const q = query.trim().replace(/[%_\\]/g, '');
	if (q.length < 2) return [];
	const users = await getDb()
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			active: schema.user.active
		})
		.from(schema.user)
		.where(or(ilike(schema.user.name, `%${q}%`), ilike(schema.user.email, `%${q}%`)))
		.orderBy(schema.user.name)
		.limit(20);
	const out: PrivacyCandidate[] = users.map((u) => ({
		source: 'core',
		sourceName: t('privacy.userAccount'),
		label: u.name,
		detail: u.active ? u.email : t('privacy.deactivatedDetail', { email: u.email }),
		subject: { userId: u.id }
	}));
	for (const m of await activeExporters()) {
		if (!m.hooks.findSubjects) continue;
		try {
			for (const c of await m.hooks.findSubjects(q, 20)) {
				out.push({ ...c, source: m.id, sourceName: m.name });
			}
		} catch (err) {
			console.error(
				`[privacy] Personensuche im Modul ${m.id} fehlgeschlagen:`,
				(err as Error)?.message
			);
		}
	}
	return out;
}

async function coreData(userId: string): Promise<Record<string, unknown> | null> {
	const db = getDb();
	const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId));
	if (!u) return null;
	const roles = await db
		.select({ id: schema.role.id, name: schema.role.name })
		.from(schema.userRole)
		.innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
		.where(eq(schema.userRole.userId, userId));
	const granted = await db
		.select({
			id: schema.role.id,
			name: schema.role.name,
			moduleId: schema.userRoleGrant.moduleId
		})
		.from(schema.userRoleGrant)
		.innerJoin(schema.role, eq(schema.role.id, schema.userRoleGrant.roleId))
		.where(eq(schema.userRoleGrant.userId, userId));
	const directPermissions = await directPermissionsOfUser(userId);
	const sessions = await db
		.select({
			createdAt: schema.session.createdAt,
			expiresAt: schema.session.expiresAt,
			ipAddress: schema.session.ipAddress,
			userAgent: schema.session.userAgent
		})
		.from(schema.session)
		.where(eq(schema.session.userId, userId));
	const keys = await db
		.select({
			name: schema.apiKey.name,
			prefix: schema.apiKey.prefix,
			scopes: schema.apiKey.scopes,
			createdAt: schema.apiKey.createdAt,
			expiresAt: schema.apiKey.expiresAt,
			revokedAt: schema.apiKey.revokedAt,
			lastUsedAt: schema.apiKey.lastUsedAt
		})
		.from(schema.apiKey)
		.where(eq(schema.apiKey.ownerId, userId));
	const settings = await db
		.select({
			key: schema.setting.key,
			value: schema.setting.value,
			updatedAt: schema.setting.updatedAt
		})
		.from(schema.setting)
		.where(eq(schema.setting.scopeId, userId));
	const notificationPrefs = await db
		.select({
			type: schema.notificationPref.typeKey,
			scope: schema.notificationPref.scope,
			channel: schema.notificationPref.channel,
			delivery: schema.notificationPref.delivery,
			updatedAt: schema.notificationPref.updatedAt
		})
		.from(schema.notificationPref)
		.where(eq(schema.notificationPref.userId, userId));
	const pushDevices = await db
		.select({
			label: schema.pushSubscription.label,
			createdAt: schema.pushSubscription.createdAt,
			lastSuccessAt: schema.pushSubscription.lastSuccessAt
		})
		.from(schema.pushSubscription)
		.where(eq(schema.pushSubscription.userId, userId));
	const queuedNotifications = await db
		.select({
			type: schema.notificationQueue.typeKey,
			title: schema.notificationQueue.title,
			createdAt: schema.notificationQueue.createdAt
		})
		.from(schema.notificationQueue)
		.where(eq(schema.notificationQueue.userId, userId));
	const files = await db
		.select({
			moduleId: schema.file.moduleId,
			path: schema.file.path,
			name: schema.file.name,
			size: schema.file.size,
			contentType: schema.file.contentType,
			createdAt: schema.file.createdAt
		})
		.from(schema.file)
		.where(eq(schema.file.createdBy, userId));
	return {
		account: {
			id: u.id,
			name: u.name,
			email: u.email,
			emailVerified: u.emailVerified,
			active: u.active,
			twoFactorEnabled: u.twoFactorEnabled,
			hasAvatar: !!u.image,
			createdAt: iso(u.createdAt),
			updatedAt: iso(u.updatedAt)
		},
		roles: roles.map((r) => ({ id: r.id, name: r.name })),
		directPermissions,
		rolesFromModules: granted.map((r) => ({ id: r.id, name: r.name, module: r.moduleId })),
		sessions: sessions.map((s) => ({
			createdAt: iso(s.createdAt),
			expiresAt: iso(s.expiresAt),
			ipAddress: s.ipAddress,
			userAgent: s.userAgent
		})),
		apiKeys: keys.map((k) => ({
			name: k.name,
			prefix: k.prefix,
			scopes: k.scopes,
			createdAt: iso(k.createdAt),
			expiresAt: iso(k.expiresAt),
			revokedAt: iso(k.revokedAt),
			lastUsedAt: iso(k.lastUsedAt)
		})),
		// Persönliche Einstellungen (Scope `user`); Secrets gibt es dort nicht
		settings: settings.map((s) => ({ key: s.key, value: s.value, updatedAt: iso(s.updatedAt) })),
		uploadedFiles: files.map((f) => ({ ...f, createdAt: iso(f.createdAt) })),
		// Benachrichtigungen: nur Abweichungen vom Standard; Geräte ohne Endpoint/Schlüssel
		notificationPreferences: notificationPrefs.map((p) => ({ ...p, updatedAt: iso(p.updatedAt) })),
		pushDevices: pushDevices.map((d) => ({
			label: d.label,
			createdAt: iso(d.createdAt),
			lastSuccessAt: iso(d.lastSuccessAt)
		})),
		queuedNotifications: queuedNotifications.map((q) => ({ ...q, createdAt: iso(q.createdAt) }))
	};
}

/** Audit-Einträge, die die Person ausgelöst hat oder die sie (Konto/Mitglied) betreffen */
async function auditData(subject: DataSubject) {
	const targets = [subject.userId, ...subject.memberIds].filter((t): t is string => !!t);
	const conds = [];
	if (subject.userId) conds.push(eq(schema.auditLog.actorId, subject.userId));
	if (targets.length) conds.push(inArray(schema.auditLog.target, targets));
	if (!conds.length) return [];
	const rows = await getDb()
		.select({
			action: schema.auditLog.action,
			actorType: schema.auditLog.actorType,
			actorId: schema.auditLog.actorId,
			target: schema.auditLog.target,
			ip: schema.auditLog.ip,
			metadata: schema.auditLog.metadata,
			createdAt: schema.auditLog.createdAt
		})
		.from(schema.auditLog)
		.where(conds.length === 1 ? conds[0] : or(...conds))
		.orderBy(desc(schema.auditLog.createdAt))
		.limit(MAX_AUDIT);
	return rows.map((r) => ({
		...r,
		// Fremde Akteur*innen nicht namentlich, nur ob die Person selbst handelte
		actorId: r.actorId === subject.userId ? r.actorId : null,
		ownAction: !!subject.userId && r.actorId === subject.userId,
		createdAt: iso(r.createdAt)
	}));
}

export async function exportSubject(
	ctx: RequestContext,
	input: { userId?: string | null; memberId?: string | null }
): Promise<SubjectExport> {
	await requirePrivacyUser(ctx);
	const userId = input.userId?.trim() || null;
	const memberId = input.memberId?.trim() || null;
	if (!userId && !memberId) {
		throw errors.validation([{ path: ['userId'], message: t('privacy.chooseSubject') }]);
	}
	if (memberId && !UUID.test(memberId)) {
		throw errors.validation([{ path: ['memberId'], message: t('privacy.invalidId') }]);
	}
	if (userId) {
		const [u] = await getDb()
			.select({ id: schema.user.id })
			.from(schema.user)
			.where(eq(schema.user.id, userId));
		if (!u) throw errors.notFound(t('privacy.userNotFound'));
	}

	const subject: DataSubject = { userId, memberIds: memberId ? [memberId] : [] };
	const exporters = await activeExporters();
	const failures: SubjectExport['errors'] = [];
	for (const m of exporters) {
		if (!m.hooks.resolve) continue;
		try {
			const extra = await m.hooks.resolve({ ...subject, memberIds: [...subject.memberIds] });
			if (!subject.userId && extra.userId) subject.userId = extra.userId;
			for (const id of extra.memberIds ?? []) {
				if (!subject.memberIds.includes(id)) subject.memberIds.push(id);
			}
		} catch (err) {
			failures.push({ module: m.id, message: (err as Error)?.message ?? t('privacy.error') });
		}
	}

	const core = subject.userId ? await coreData(subject.userId) : null;
	const audit = await auditData(subject);
	const modules: SubjectExport['modules'] = {};
	for (const m of exporters) {
		try {
			const data = await m.hooks.run({ ...subject, memberIds: [...subject.memberIds] });
			if (data && Object.keys(data).length) modules[m.id] = { name: m.name, data };
		} catch (err) {
			console.error(
				`[privacy] Datenauskunft im Modul ${m.id} fehlgeschlagen:`,
				(err as Error)?.message
			);
			failures.push({ module: m.id, message: (err as Error)?.message ?? t('privacy.error') });
		}
	}

	await auditFromContext(ctx, 'core.privacy.exported', {
		target: subject.userId ?? subject.memberIds[0],
		metadata: {
			hasAccount: !!subject.userId,
			members: subject.memberIds.length,
			modules: Object.keys(modules),
			failed: failures.map((f) => f.module)
		}
	});
	return {
		format: 'atrium-datenauskunft',
		version: 1,
		generatedAt: new Date().toISOString(),
		subject,
		core: core ? { ...core, audit } : audit.length ? { audit } : null,
		modules,
		errors: failures
	};
}
