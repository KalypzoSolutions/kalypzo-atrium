/** Zugriff auf die Datensicherung: Recht `core.system.backup`, nur angemeldete Benutzer (keine API-Keys). */
import type { RequestContext } from '$lib/sdk/types';
import { errors } from '../errors';
import { requirePermission } from '../permissions/service';
import { allDefinitions } from '../modules/registry';
import { localized, t } from '$lib/i18n';

export async function requireBackupUser(ctx: RequestContext): Promise<string> {
	await requirePermission(ctx, 'core.system.backup');
	if (ctx.actor.type !== 'user' || !ctx.userId) {
		throw errors.forbidden(t('backup.access.onlyUsers'));
	}
	return ctx.userId;
}

/**
 * Bereiche, die nur Administrator*innen wiederherstellen oder zusammenführen dürfen (#16): Sie enthalten
 * Konten, Rollen und Rechte, API-Keys bzw. Rollen-Verleihungen. Die Sicherung ist mit dem eigenen Passwort
 * entschlüsselbar und damit veränderbar – sonst könnte sich eine Person mit Sicherungsrecht über eine
 * manipulierte Datei weitere Rechte verschaffen. Module melden sich über `backup.adminOnlyRestore` an.
 */
export const CORE_ADMIN_ONLY_RESTORE_SCOPES: ReadonlySet<string> = new Set([
	'core:users',
	'core:roles',
	'core:api-keys'
]);

/** Bereich → Grund für alle Bereiche, die nur Administrator*innen wiederherstellen dürfen (Core + Module) */
export function adminOnlyRestoreScopes(): Map<string, string> {
	const out = new Map<string, string>(
		[...CORE_ADMIN_ONLY_RESTORE_SCOPES].map((s) => [s, t('backup.access.adminOnlyCore')])
	);
	for (const d of allDefinitions()) {
		const why = d.backup?.adminOnlyRestore;
		if (why) {
			out.set(
				d.manifest.id,
				t('backup.access.adminOnlyModule', { name: localized(d.manifest.name), reason: why })
			);
		}
	}
	return out;
}
