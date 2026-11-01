import type { RequestContext } from '$lib/sdk/types';
import { errors } from '../errors';
import { getUserPermissions } from '../permissions/service';
import { t } from '$lib/i18n';

/**
 * Schutz vor Rechteausweitung bei Kontoänderungen (E-Mail, Status, Profilbild, Rollen, Löschen):
 * Die handelnde Person muss **alle wirksamen Rechte** des Zielkontos selbst besitzen – inklusive der
 * Rechte aus Modul-Verleihungen (`user_role_grant`, z. B. Ämter). Sonst könnte z. B. jemand mit
 * `core.users.edit` die Adresse eines Admin-Kontos ändern und es per „Passwort vergessen“ übernehmen.
 * System-Kontext und das eigene Konto sind ausgenommen. Unbekannte Konten haben keine Rechte
 * (der Aufrufer liefert danach seine eigene 404).
 */
export async function canManageUser(ctx: RequestContext, targetId: string): Promise<boolean> {
	return (await missingPermissions(ctx, targetId)).length === 0;
}

/** Wie `canManageUser`, wirft aber 403 mit Meldung. */
export async function assertCanManageUser(ctx: RequestContext, targetId: string): Promise<void> {
	if ((await missingPermissions(ctx, targetId)).length) {
		throw errors.forbidden(t('auth.manageGuardForbidden'));
	}
}

async function missingPermissions(ctx: RequestContext, targetId: string): Promise<string[]> {
	if (ctx.actor.type === 'system') return [];
	if (ctx.userId && ctx.userId === targetId) return [];
	const target = await getUserPermissions(targetId);
	return [...target].filter((k) => !ctx.permissions.has(k));
}
