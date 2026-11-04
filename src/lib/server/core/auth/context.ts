import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { getDb, schema } from '../database/client';
import { sha256 } from '../crypto';
import { errors } from '../errors';
import { getUserPermissions } from '../permissions/service';
import { getAuth } from './index';
import { activeImpersonation } from './admin/impersonation';

export interface SessionUser {
	id: string;
	name: string;
	email: string;
	image: string | null;
	twoFactorEnabled: boolean;
	/** Passwort von der Verwaltung gesetzt – erst selbst ändern (Guard leitet ins Profil) */
	mustChangePassword?: boolean;
}

export function systemContext(name = 'system'): RequestContext {
	return {
		actor: { type: 'system', id: null, name },
		userId: null,
		permissions: new Set(),
		ip: null,
		requestId: randomUUID()
	};
}

export function anonymousContext(ip: string | null = null): RequestContext {
	return {
		actor: { type: 'user', id: null, name: 'anonymous' },
		userId: null,
		permissions: new Set(),
		ip,
		requestId: randomUUID()
	};
}

export async function contextForUser(
	userId: string,
	meta: { ip?: string | null; requestId?: string } = {}
): Promise<{ ctx: RequestContext; user: SessionUser } | null> {
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, userId));
	if (!u || !u.active) return null;
	const permissions = await getUserPermissions(u.id);
	return {
		user: {
			id: u.id,
			name: u.name,
			email: u.email,
			image: u.image,
			twoFactorEnabled: u.twoFactorEnabled,
			mustChangePassword: u.mustChangePassword
		},
		ctx: {
			actor: { type: 'user', id: u.id, name: u.email },
			userId: u.id,
			permissions,
			ip: meta.ip ?? null,
			requestId: meta.requestId ?? randomUUID()
		}
	};
}

/** Läuft „Als Person handeln“, steht hier, wer handelt und bis wann (für Banner und Sperren). */
export interface ImpersonationInfo {
	id: string;
	admin: { id: string; name: string };
	target: { id: string; name: string };
	expiresAt: string;
}

/**
 * Löst die Session aus den Request-Headern auf. Deaktivierte Benutzer werden abgelehnt.
 * Hat die Sitzung eine offene Impersonation, laufen Kontext und `user` als Zielperson; `ctx.actor.impersonator`
 * nennt das handelnde Admin-Konto (Audit). Gilt für Seiten, REST (Session) und Live-Streams gleichermaßen.
 */
export async function resolveSession(
	headers: Headers,
	meta: { ip?: string | null; requestId?: string } = {}
): Promise<{
	ctx: RequestContext;
	user: SessionUser;
	sessionId: string;
	impersonation: ImpersonationInfo | null;
} | null> {
	const session = await getAuth().api.getSession({ headers });
	if (!session) return null;
	const imp = await activeImpersonation(session.session.id);
	if (imp) {
		const target = await contextForUser(imp.target.id, meta);
		if (target) {
			target.ctx.actor = {
				...target.ctx.actor,
				impersonator: { id: imp.admin.id, name: imp.admin.email }
			};
			return {
				...target,
				sessionId: session.session.id,
				impersonation: {
					id: imp.id,
					admin: { id: imp.admin.id, name: imp.admin.name },
					target: imp.target,
					expiresAt: imp.expiresAt.toISOString()
				}
			};
		}
	}
	const resolved = await contextForUser(session.user.id, meta);
	if (!resolved) return null;
	return { ...resolved, sessionId: session.session.id, impersonation: null };
}

export const API_KEY_PREFIX = 'epk_';

/**
 * Löst einen API-Key auf. Wirksame Rechte = Scopes ∩ aktuelle Rechte des Eigentümers,
 * dadurch kann ein Key nie mehr als sein Besitzer.
 */
export async function resolveApiKey(
	rawKey: string,
	meta: { ip?: string | null; requestId?: string } = {}
): Promise<{ ctx: RequestContext; keyId: string } | null> {
	if (!rawKey.startsWith(API_KEY_PREFIX)) return null;
	const db = getDb();
	const [key] = await db
		.select()
		.from(schema.apiKey)
		.where(eq(schema.apiKey.hash, sha256(rawKey)));
	if (!key || key.revokedAt) return null;
	if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) return null;
	const owner = await contextForUser(key.ownerId, meta);
	if (!owner) return null;
	const permissions = new Set(key.scopes.filter((s) => owner.ctx.permissions.has(s)));
	// lastUsedAt ohne Rückwirkung auf die Anfrage aktualisieren
	void db
		.update(schema.apiKey)
		.set({ lastUsedAt: new Date() })
		.where(eq(schema.apiKey.id, key.id))
		.catch(() => undefined);
	return {
		keyId: key.id,
		ctx: {
			actor: { type: 'api_key', id: key.id, name: `${key.name} (${key.prefix})` },
			userId: key.ownerId,
			permissions,
			ip: meta.ip ?? null,
			requestId: meta.requestId ?? randomUUID()
		}
	};
}

export function requireUser(ctx: RequestContext): string {
	if (!ctx.userId) throw errors.unauthenticated();
	return ctx.userId;
}
