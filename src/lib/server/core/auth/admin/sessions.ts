/**
 * Sitzungen und Zwei-Faktor-Anmeldung einer Person – für das eigene Profil und für die Verwaltung.
 * Tokens verlassen den Server nie; Sitzungen werden über ihre ID angesprochen.
 */
import { and, desc, eq, gt } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { t } from '$lib/i18n';
import { auditFromContext } from '../../audit/service';
import { getDb, schema } from '../../database/client';
import { errors } from '../../errors';
import { requirePermission } from '../../permissions/service';
import { loadManageableTarget } from './password';

export interface UserSessionItem {
	id: string;
	ipAddress: string | null;
	userAgent: string | null;
	createdAt: Date;
	/** Zuletzt erneuert (Better Auth aktualisiert höchstens einmal am Tag) */
	updatedAt: Date;
	expiresAt: Date;
}

/**
 * Gültige Sitzungen eines Kontos direkt aus der Datenbank (ohne Token). `api.listSessions` verlangt eine frische
 * Sitzung und taugt deshalb weder fürs Profil noch für die Verwaltung.
 */
export function sessionsOfUser(userId: string): Promise<UserSessionItem[]> {
	return getDb()
		.select({
			id: schema.session.id,
			ipAddress: schema.session.ipAddress,
			userAgent: schema.session.userAgent,
			createdAt: schema.session.createdAt,
			updatedAt: schema.session.updatedAt,
			expiresAt: schema.session.expiresAt
		})
		.from(schema.session)
		.where(and(eq(schema.session.userId, userId), gt(schema.session.expiresAt, new Date())))
		.orderBy(desc(schema.session.updatedAt));
}

/** Sitzungen einer Person für die Verwaltung (`core.users.view`). */
export async function listUserSessions(
	ctx: RequestContext,
	userId: string
): Promise<UserSessionItem[]> {
	await requirePermission(ctx, 'core.users.view');
	const [u] = await getDb()
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!u) throw errors.notFound(t('auth.userNotFound'));
	return sessionsOfUser(userId);
}

/** Beendet eine Sitzung (`sessionId`) oder alle Sitzungen der Person. Liefert die Anzahl. */
export async function revokeUserSessions(
	ctx: RequestContext,
	userId: string,
	sessionId?: string
): Promise<number> {
	const u = await loadManageableTarget(ctx, userId);
	const where = sessionId
		? and(eq(schema.session.userId, u.id), eq(schema.session.id, sessionId))
		: eq(schema.session.userId, u.id);
	const gone = await getDb()
		.delete(schema.session)
		.where(where)
		.returning({ id: schema.session.id });
	if (sessionId && !gone.length) throw errors.notFound(t('admin-users.server.sessionNotFound'));
	await auditFromContext(ctx, 'core.user.sessions_revoked', {
		target: u.id,
		metadata: { count: gone.length, all: !sessionId }
	});
	return gone.length;
}

/**
 * Setzt die Zwei-Faktor-Anmeldung zurück (z. B. Handy verloren): Geheimnis und Backup-Codes weg, Sitzungen enden.
 * Die Person kann 2FA danach im Profil neu einrichten.
 */
export async function resetTwoFactor(ctx: RequestContext, userId: string): Promise<void> {
	const u = await loadManageableTarget(ctx, userId);
	await getDb().transaction(async (tx) => {
		await tx.delete(schema.twoFactor).where(eq(schema.twoFactor.userId, u.id));
		await tx
			.update(schema.user)
			.set({ twoFactorEnabled: false, updatedAt: new Date() })
			.where(eq(schema.user.id, u.id));
		const gone = await tx
			.delete(schema.session)
			.where(eq(schema.session.userId, u.id))
			.returning({ id: schema.session.id });
		await auditFromContext(
			ctx,
			'core.user.two_factor_reset',
			{ target: u.id, metadata: { sessionsRevoked: gone.length } },
			tx
		);
	});
}
