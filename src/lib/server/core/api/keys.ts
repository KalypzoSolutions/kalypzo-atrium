import { t } from '$lib/i18n';
import { desc, eq } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { API_KEY_PREFIX } from '../auth/context';
import { randomToken, sha256 } from '../crypto';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { assertCanGrant, existingKeys, requirePermission } from '../permissions/service';
import { newId } from '../util';

export interface ApiKeyItem {
	id: string;
	name: string;
	prefix: string;
	scopes: string[];
	ownerId: string;
	expiresAt: Date | null;
	revokedAt: Date | null;
	lastUsedAt: Date | null;
	createdAt: Date;
}

const toItem = (r: typeof schema.apiKey.$inferSelect): ApiKeyItem => ({
	id: r.id,
	name: r.name,
	prefix: r.prefix,
	scopes: r.scopes,
	ownerId: r.ownerId,
	expiresAt: r.expiresAt,
	revokedAt: r.revokedAt,
	lastUsedAt: r.lastUsedAt,
	createdAt: r.createdAt
});

export async function listApiKeys(ctx: RequestContext): Promise<ApiKeyItem[]> {
	await requirePermission(ctx, 'core.api.view');
	const rows = await getDb().select().from(schema.apiKey).orderBy(desc(schema.apiKey.createdAt));
	return rows.map(toItem);
}

/**
 * Erzeugt einen API-Key. Der Klartext-Key wird genau einmal zurückgegeben und
 * ausschließlich als SHA-256-Hash gespeichert.
 */
export async function createApiKey(
	ctx: RequestContext,
	input: { name: string; scopes: string[]; expiresAt?: Date | null }
): Promise<{ key: string; item: ApiKeyItem }> {
	await requirePermission(ctx, 'core.api.manage');
	if (!ctx.userId) throw errors.unauthenticated();
	if (ctx.actor.type === 'api_key') throw errors.forbidden(t('api.keys.noKeysFromKeys'));
	const scopes = [...new Set(input.scopes)];
	if (!scopes.length) throw errors.badRequest(t('api.keys.scopeRequired'));
	const known = await existingKeys(scopes);
	const unknown = scopes.filter((s) => !known.has(s));
	if (unknown.length)
		throw errors.badRequest(t('api.keys.unknownScopes', { scopes: unknown.join(', ') }));
	assertCanGrant(ctx, scopes);
	if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
		throw errors.badRequest(t('api.keys.expiryInPast'));
	}
	const secret = randomToken(32);
	const key = `${API_KEY_PREFIX}${secret}`;
	const [row] = await getDb()
		.insert(schema.apiKey)
		.values({
			id: newId(),
			name: input.name.trim(),
			prefix: key.slice(0, API_KEY_PREFIX.length + 8),
			hash: sha256(key),
			scopes,
			ownerId: ctx.userId,
			expiresAt: input.expiresAt ?? null
		})
		.returning();
	if (!row) throw new Error('API-Key konnte nicht gespeichert werden');
	await auditFromContext(ctx, 'core.api_key.created', {
		target: row.id,
		metadata: { name: row.name, scopes, expiresAt: input.expiresAt?.toISOString() ?? null }
	});
	return { key, item: toItem(row) };
}

export async function revokeApiKey(ctx: RequestContext, id: string): Promise<void> {
	await requirePermission(ctx, 'core.api.manage');
	const res = await getDb()
		.update(schema.apiKey)
		.set({ revokedAt: new Date() })
		.where(eq(schema.apiKey.id, id))
		.returning({ id: schema.apiKey.id });
	if (!res.length) throw errors.notFound(t('api.keys.notFound'));
	await auditFromContext(ctx, 'core.api_key.revoked', { target: id });
}
