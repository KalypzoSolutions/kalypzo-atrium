/** Zugriff auf die Datensicherung: Recht `core.system.backup`, nur angemeldete Benutzer (keine API-Keys). */
import type { RequestContext } from '$lib/sdk/types';
import { errors } from '../errors';
import { requirePermission } from '../permissions/service';
import { allDefinitions } from '../modules/registry';

export async function requireBackupUser(ctx: RequestContext): Promise<string> {
	await requirePermission(ctx, 'core.system.backup');
	if (ctx.actor.type !== 'user' || !ctx.userId) {
		throw errors.forbidden('Datensicherung ist nur für angemeldete Benutzer möglich');
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

const CORE_REASON =
	'Nur Administrator*innen dürfen Konten, Rollen und API-Keys wiederherstellen oder zusammenführen.';

/** Bereich → Grund für alle Bereiche, die nur Administrator*innen wiederherstellen dürfen (Core + Module) */
export function adminOnlyRestoreScopes(): Map<string, string> {
	const out = new Map<string, string>(
		[...CORE_ADMIN_ONLY_RESTORE_SCOPES].map((s) => [s, CORE_REASON])
	);
	for (const d of allDefinitions()) {
		const why = d.backup?.adminOnlyRestore;
		if (why) {
			out.set(
				d.manifest.id,
				`Nur Administrator*innen dürfen „${d.manifest.name}“ wiederherstellen oder zusammenführen (${why}).`
			);
		}
	}
	return out;
}
