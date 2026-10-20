/** Zugriff auf die Datensicherung: Recht `core.system.backup`, nur angemeldete Benutzer (keine API-Keys). */
import type { RequestContext } from '$lib/sdk/types';
import { errors } from '../errors';
import { requirePermission } from '../permissions/service';

export async function requireBackupUser(ctx: RequestContext): Promise<string> {
	await requirePermission(ctx, 'core.system.backup');
	if (ctx.actor.type !== 'user' || !ctx.userId) {
		throw errors.forbidden('Datensicherung ist nur für angemeldete Benutzer möglich');
	}
	return ctx.userId;
}
