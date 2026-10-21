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

/**
 * Bereiche, die nur Administrator*innen wiederherstellen oder zusammenführen dürfen (#16): Sie enthalten
 * Konten, Rollen und Rechte, API-Keys bzw. Rollen-Verleihungen (Ämter). Die Sicherung ist mit dem eigenen
 * Passwort entschlüsselbar und damit veränderbar – sonst könnte sich eine Person mit Sicherungsrecht über
 * eine manipulierte Datei weitere Rechte verschaffen.
 */
export const ADMIN_ONLY_RESTORE_SCOPES: ReadonlySet<string> = new Set([
	'core:users',
	'core:roles',
	'core:api-keys',
	'offices'
]);

export const ADMIN_ONLY_RESTORE_REASON =
	'Nur Administrator*innen dürfen Konten, Rollen, API-Keys und Ämter wiederherstellen oder zusammenführen.';
