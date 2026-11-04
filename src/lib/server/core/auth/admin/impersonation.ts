/**
 * „Als Person handeln“ (Impersonation): Eine Admin-Person handelt für begrenzte Zeit vollständig als ein anderes
 * Konto – mit dessen Rechten und Daten, inklusive Änderungen. Gebunden an die **Sitzung** der Admin-Person
 * (Tabelle `user_impersonation`), aufgelöst zentral in `resolveSession` (Seiten, REST, Live-Streams).
 *
 * Schutz: Recht `core.users.impersonate` (admin-gleich), Re-Auth, Pflichtgrund, höchstens 60 min, nur Konten mit
 * höchstens eigenen Rechten und nie Administrator*innen. Jede Audit-Zeile trägt `impersonator_id`. Konto-Sicherheit
 * (Passwort, 2FA, Sitzungen, E-Mail, API-Keys, QR-Login, Re-Auth-Vorgänge) bleibt währenddessen gesperrt.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { t } from '$lib/i18n';
import { auditFromContext, logAudit } from '../../audit/service';
import { getDb, schema } from '../../database/client';
import { errors } from '../../errors';
import { withLocale } from '../../i18n/locale';
import { sendMail } from '../../mail';
import { CORE_PERMISSIONS } from '../../permissions/catalog';
import { getUserPermissions, requirePermission } from '../../permissions/service';
import { getSetting } from '../../settings/service';
import { verifyReauth } from '../../system/maintenance';
import { newId } from '../../util';
import { accountMailLocale } from '../account-mail';
import { canManageUser } from '../manage-guard';
import { maskEmail } from '../mask-email';

export const IMPERSONATION_MINUTES = [15, 30, 60] as const;
export const IMPERSONATION_REASON_MAX = 500;
/** Kurzer Cache je Sitzung: Rechteentzug und Ablauf greifen spätestens danach */
const CACHE_MS = 5_000;

export interface ActiveImpersonation {
	id: string;
	sessionId: string;
	admin: { id: string; name: string; email: string };
	target: { id: string; name: string };
	startedAt: Date;
	expiresAt: Date;
}

const cache = new Map<string, { at: number; value: ActiveImpersonation | null }>();

export function invalidateImpersonationCache(sessionId?: string): void {
	if (sessionId) cache.delete(sessionId);
	else cache.clear();
}

/** Darf das Konto (mit diesen Rechten) Ziel sein? Nie Administrator*innen. */
function isAdminLike(perms: ReadonlySet<string>): boolean {
	return Object.keys(CORE_PERMISSIONS).every((k) => perms.has(k));
}

async function endRow(
	row: { id: string; adminUserId: string; targetUserId: string; sessionId: string | null },
	reason: 'stopped' | 'expired' | 'revoked',
	ctx?: RequestContext
): Promise<void> {
	const done = await getDb()
		.update(schema.userImpersonation)
		.set({ endedAt: new Date(), endReason: reason })
		.where(and(eq(schema.userImpersonation.id, row.id), isNull(schema.userImpersonation.endedAt)))
		.returning({ id: schema.userImpersonation.id });
	if (row.sessionId) invalidateImpersonationCache(row.sessionId);
	if (!done.length) return;
	const metadata = { impersonationId: row.id, reason };
	if (ctx) {
		await auditFromContext(ctx, 'core.user.impersonation_ended', {
			target: row.targetUserId,
			metadata
		});
	} else {
		await logAudit({
			action: 'core.user.impersonation_ended',
			actor: { type: 'system', id: null, name: 'impersonation' },
			target: row.targetUserId,
			metadata: { ...metadata, admin: row.adminUserId }
		});
	}
}

/**
 * Offene Impersonation zur Sitzung (oder `null`). Beendet sie selbst, wenn sie abgelaufen ist, die Admin-Person das
 * Recht verloren hat oder das Ziel nicht mehr verwaltbar ist.
 */
export async function activeImpersonation(sessionId: string): Promise<ActiveImpersonation | null> {
	const hit = cache.get(sessionId);
	if (hit && Date.now() - hit.at < CACHE_MS && (!hit.value || hit.value.expiresAt > new Date())) {
		return hit.value;
	}
	const value = await loadActive(sessionId);
	cache.set(sessionId, { at: Date.now(), value });
	if (cache.size > 5000) cache.delete(cache.keys().next().value!);
	return value;
}

async function loadActive(sessionId: string): Promise<ActiveImpersonation | null> {
	const db = getDb();
	const [row] = await db
		.select()
		.from(schema.userImpersonation)
		.where(
			and(
				eq(schema.userImpersonation.sessionId, sessionId),
				isNull(schema.userImpersonation.endedAt)
			)
		)
		.limit(1);
	if (!row) return null;
	if (row.expiresAt <= new Date()) {
		await endRow(row, 'expired');
		return null;
	}
	const [admin] = await db
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			active: schema.user.active
		})
		.from(schema.user)
		.where(eq(schema.user.id, row.adminUserId));
	const [target] = await db
		.select({ id: schema.user.id, name: schema.user.name, active: schema.user.active })
		.from(schema.user)
		.where(eq(schema.user.id, row.targetUserId));
	const adminPerms = admin?.active ? await getUserPermissions(admin.id) : new Set<string>();
	const targetPerms = target?.active ? await getUserPermissions(target.id) : null;
	const stillAllowed =
		!!admin &&
		!!target &&
		!!targetPerms &&
		adminPerms.has('core.users.impersonate') &&
		[...targetPerms].every((p) => adminPerms.has(p)) &&
		!isAdminLike(targetPerms);
	if (!stillAllowed) {
		await endRow(row, 'revoked');
		return null;
	}
	return {
		id: row.id,
		sessionId,
		admin: { id: admin.id, name: admin.name, email: admin.email },
		target: { id: target.id, name: target.name },
		startedAt: row.startedAt,
		expiresAt: row.expiresAt
	};
}

/** Wirft 403, solange die Anfrage „als jemand“ läuft (Konto-Sicherheit, Re-Auth-Vorgänge). */
export function assertNotImpersonating(ctx: RequestContext): void {
	if (ctx.actor.impersonator)
		throw errors.forbidden(t('admin-users.server.blockedWhileImpersonating'));
}

export interface StartImpersonationInput {
	targetUserId: string;
	reason: string;
	minutes: number;
	password: string;
	totp?: string;
}

/**
 * Startet das Handeln als `targetUserId` für die **aktuelle Sitzung** der Admin-Person. Danach lädt die Seite neu
 * und alle Anfragen dieser Sitzung laufen als Zielperson.
 */
export async function startImpersonation(
	ctx: RequestContext,
	sessionId: string,
	input: StartImpersonationInput
): Promise<ActiveImpersonation> {
	assertNotImpersonating(ctx);
	await requirePermission(ctx, 'core.users.impersonate');
	const adminId = ctx.userId;
	if (!adminId || ctx.actor.type !== 'user') throw errors.unauthenticated();
	const reason = input.reason.trim();
	if (reason.length < 3 || reason.length > IMPERSONATION_REASON_MAX) {
		throw errors.validation(
			[{ path: ['reason'], message: t('admin-users.server.reasonRequired') }],
			t('admin-users.server.reasonRequired')
		);
	}
	if (!(IMPERSONATION_MINUTES as readonly number[]).includes(input.minutes)) {
		throw errors.badRequest(t('admin-users.server.invalidDuration'));
	}
	const db = getDb();
	const [target] = await db
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			active: schema.user.active
		})
		.from(schema.user)
		.where(eq(schema.user.id, input.targetUserId));
	if (!target) throw errors.notFound(t('auth.userNotFound'));
	if (target.id === adminId) throw errors.badRequest(t('admin-users.server.notOnSelf'));
	if (!target.active) throw errors.conflict(t('admin-users.server.inactiveAccount'));
	if (!(await canManageUser(ctx, target.id))) {
		throw errors.forbidden(t('auth.manageGuardForbidden'));
	}
	if (isAdminLike(await getUserPermissions(target.id))) {
		throw errors.forbidden(t('admin-users.server.noAdminTarget'));
	}
	// Erst alle anderen Prüfungen, dann das Passwort (Fehlversuche zählen nur bei sinnvollen Anfragen)
	await verifyReauth(adminId, { password: input.password, totp: input.totp }, 'impersonate');

	// Höchstens eine offene Impersonation je Sitzung
	const open = await db
		.select()
		.from(schema.userImpersonation)
		.where(
			and(
				eq(schema.userImpersonation.sessionId, sessionId),
				isNull(schema.userImpersonation.endedAt)
			)
		);
	for (const row of open) await endRow(row, 'stopped', ctx);

	const now = new Date();
	const row = {
		id: newId(),
		sessionId,
		adminUserId: adminId,
		targetUserId: target.id,
		reason,
		ip: ctx.ip,
		startedAt: now,
		expiresAt: new Date(now.getTime() + input.minutes * 60_000)
	};
	await db.insert(schema.userImpersonation).values(row);
	invalidateImpersonationCache(sessionId);
	await auditFromContext(ctx, 'core.user.impersonation_started', {
		target: target.id,
		metadata: { impersonationId: row.id, minutes: input.minutes }
	});
	const [admin] = await db
		.select({ name: schema.user.name, email: schema.user.email })
		.from(schema.user)
		.where(eq(schema.user.id, adminId));
	notifyTarget(target, admin?.name || maskEmail(admin?.email ?? ''));
	return {
		id: row.id,
		sessionId,
		admin: { id: adminId, name: admin?.name ?? '', email: admin?.email ?? '' },
		target: { id: target.id, name: target.name },
		startedAt: row.startedAt,
		expiresAt: row.expiresAt
	};
}

/** Beendet das Handeln der Sitzung (Knopf „Beenden“). `ctx` = Kontext der laufenden Anfrage (als Zielperson). */
export async function stopImpersonation(
	sessionId: string,
	ctx?: RequestContext
): Promise<string | null> {
	const rows = await getDb()
		.select()
		.from(schema.userImpersonation)
		.where(
			and(
				eq(schema.userImpersonation.sessionId, sessionId),
				isNull(schema.userImpersonation.endedAt)
			)
		);
	for (const row of rows) await endRow(row, 'stopped', ctx);
	invalidateImpersonationCache(sessionId);
	return rows[0]?.targetUserId ?? null;
}

/** Beendet alle offenen Impersonations mit diesem Ziel (Konto gesperrt/gelöscht, Rechte geändert). */
export async function endImpersonationsOf(targetUserId: string): Promise<void> {
	const rows = await getDb()
		.select()
		.from(schema.userImpersonation)
		.where(
			and(
				eq(schema.userImpersonation.targetUserId, targetUserId),
				isNull(schema.userImpersonation.endedAt)
			)
		);
	for (const row of rows) await endRow(row, 'revoked');
}

/** Laufende Impersonations (für die Admin-Übersicht). */
export async function countActiveImpersonations(): Promise<number> {
	const rows = await getDb()
		.select({ id: schema.userImpersonation.id, expiresAt: schema.userImpersonation.expiresAt })
		.from(schema.userImpersonation)
		.where(isNull(schema.userImpersonation.endedAt));
	return rows.filter((r) => r.expiresAt > new Date()).length;
}

/** Bisherige Impersonations einer Person (Detailseite, Datenauskunft) – mit Grund, nur für die Verwaltung. */
export async function impersonationsOf(ctx: RequestContext, targetUserId: string, limit = 20) {
	await requirePermission(ctx, 'core.users.view');
	const rows = await getDb()
		.select({
			id: schema.userImpersonation.id,
			adminUserId: schema.userImpersonation.adminUserId,
			adminName: schema.user.name,
			reason: schema.userImpersonation.reason,
			startedAt: schema.userImpersonation.startedAt,
			expiresAt: schema.userImpersonation.expiresAt,
			endedAt: schema.userImpersonation.endedAt,
			endReason: schema.userImpersonation.endReason
		})
		.from(schema.userImpersonation)
		.leftJoin(schema.user, eq(schema.user.id, schema.userImpersonation.adminUserId))
		.where(eq(schema.userImpersonation.targetUserId, targetUserId))
		.orderBy(schema.userImpersonation.startedAt)
		.limit(Math.min(limit, 100));
	return rows.reverse();
}

/** Hinweis-Mail an die Zielperson (Einstellung `core.system.impersonationNotify`, Standard an), Fire-and-forget. */
function notifyTarget(
	target: { id: string; name: string; email: string },
	adminLabel: string
): void {
	void (async () => {
		if (!(await getSetting<boolean>('core.system.impersonationNotify'))) return;
		const [system, locale] = await Promise.all([
			getSetting<string>('core.system.name'),
			accountMailLocale(target.id, 'system')
		]);
		await withLocale(locale, () =>
			sendMail({
				to: target.email,
				subject: t('account-mail.impersonated.subject', { system: system || 'Kalypzo Atrium' }),
				text: t('account-mail.impersonated.text', {
					name: target.name,
					admin: adminLabel
				})
			})
		);
	})().catch((err) =>
		console.error('[mail] Hinweis zum Handeln als Person fehlgeschlagen:', err?.message)
	);
}
