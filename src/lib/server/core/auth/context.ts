import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { getDb, schema } from '../database/client';
import { sha256 } from '../crypto';
import { errors } from '../errors';
import { getUserPermissions } from '../permissions/service';
import { getAuth } from './index';

export interface SessionUser {
	id: string;
	name: string;
	email: string;
	image: string | null;
	twoFactorEnabled: boolean;
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
			twoFactorEnabled: u.twoFactorEnabled
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

/** Loest die Session aus den Request-Headern auf. Deaktivierte Benutzer werden abgelehnt. */
export async function resolveSession(
	headers: Headers,
	meta: { ip?: string | null; requestId?: string } = {}
): Promise<{ ctx: RequestContext; user: SessionUser; sessionId: string } | null> {
	const session = await getAuth().api.getSession({ headers });
	if (!session) return null;
	const resolved = await contextForUser(session.user.id, meta);
	if (!resolved) return null;
	return { ...resolved, sessionId: session.session.id };
}

export const API_KEY_PREFIX = 'epk_';

/**
 * Loest einen API-Key auf. Wirksame Rechte = Scopes ∩ aktuelle Rechte des Eigentuemers,
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
	// lastUsedAt ohne Rueckwirkung auf die Anfrage aktualisieren
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
