/**
 * Vom Core verwaltete Standardrollen (`defaultRoleGrants` der Module, Rolle „Mitglied“ der Konto-Verknüpfung).
 *
 * Zuordnung über die stabile Kennung `role.system_key = 'default:<Name>'` (Migration 0008, #67 01a-07) – **nie**
 * über den Anzeigenamen allein. Sonst könnte jemand mit `core.roles.create` vor der Modulaktivierung eine leere,
 * gleichnamige Rolle anlegen, sich zuweisen und danach automatisch die Modulrechte erhalten.
 *
 * - Existiert die Rolle mit Kennung → sie wird verwendet (auch wenn sie inzwischen umbenannt wurde).
 * - Existiert keine, ist der Name aber frei → Rolle mit Kennung anlegen.
 * - Existiert eine **gleichnamige Rolle ohne Kennung** → nichts vergeben (`null`), Warnung im Log. Die
 *   Administration entscheidet: Rolle umbenennen/löschen (beim nächsten Start entsteht die Standardrolle) oder
 *   ausdrücklich übernehmen (`adoptDefaultRole`).
 */
import { t } from '$lib/i18n';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema, type DbOrTx } from '../database/client';
import { errors } from '../errors';
import { allDefinitions } from '../modules/registry';
import { newId } from '../util';
import { isAdministrator, requirePermission } from './service';

export const DEFAULT_ROLE_KEY_PREFIX = 'default:';

export const defaultRoleKey = (name: string): string => `${DEFAULT_ROLE_KEY_PREFIX}${name}`;

/** Namen aller Standardrollen registrierter Module (`defaultRoleGrants`) – reserviert. */
export function reservedDefaultRoleNames(): Set<string> {
	const names = new Set<string>();
	for (const d of allDefinitions()) {
		for (const name of Object.keys(d.defaultRoleGrants ?? d.manifest.defaultRoleGrants ?? {})) {
			names.add(name);
		}
	}
	return names;
}

/** ID der Standardrolle mit Kennung `default:<name>` oder `null`. */
export async function findDefaultRoleId(
	name: string,
	db: DbOrTx = getDb()
): Promise<string | null> {
	const [row] = await db
		.select({ id: schema.role.id })
		.from(schema.role)
		.where(eq(schema.role.systemKey, defaultRoleKey(name)));
	return row?.id ?? null;
}

const warned = new Set<string>();

/**
 * Standardrolle finden oder anlegen. `null`, wenn eine gleichnamige Rolle **ohne** Kennung den Namen belegt
 * (möglicher Squatting-Versuch oder Altbestand) – dann werden keine Rechte vergeben.
 */
export async function ensureDefaultRole(
	name: string,
	db: DbOrTx = getDb()
): Promise<string | null> {
	const existing = await findDefaultRoleId(name, db);
	if (existing) return existing;
	await db
		.insert(schema.role)
		.values({
			id: newId(),
			name,
			description: t('permissions.roles.autoCreated'),
			isSystem: false,
			systemKey: defaultRoleKey(name)
		})
		.onConflictDoNothing();
	const created = await findDefaultRoleId(name, db);
	if (created) return created;
	if (!warned.has(name)) {
		warned.add(name);
		console.warn(
			`[roles] Rolle „${name}“ existiert bereits ohne Standard-Kennung – keine automatischen Rechte ` +
				'vergeben. Administration: Rolle umbenennen/löschen oder ausdrücklich übernehmen (docs/security.md).'
		);
	}
	return null;
}

/**
 * Bestehende, gleichnamige Rolle **ausdrücklich** als Standardrolle übernehmen (Admin-Bestätigung).
 * Nur für Administrator*innen (`core.roles.edit` und alle privilegierten Rechte), weil die Rolle danach
 * automatisch Modulrechte erhält.
 */
export async function adoptDefaultRole(ctx: RequestContext, roleId: string): Promise<void> {
	await requirePermission(ctx, 'core.roles.edit');
	if (!isAdministrator(ctx)) {
		throw errors.forbidden(t('permissions.roles.adoptAdminOnly'));
	}
	const db = getDb();
	const [role] = await db.select().from(schema.role).where(eq(schema.role.id, roleId));
	if (!role) throw errors.notFound(t('permissions.roles.notFound'));
	if (role.isSystem || !reservedDefaultRoleNames().has(role.name)) {
		throw errors.badRequest(t('permissions.roles.notDefaultRole'));
	}
	if (await findDefaultRoleId(role.name, db)) {
		throw errors.conflict(t('permissions.roles.defaultExists'));
	}
	await db
		.update(schema.role)
		.set({ systemKey: defaultRoleKey(role.name), updatedAt: new Date() })
		.where(and(eq(schema.role.id, roleId), isNull(schema.role.systemKey)));
	await auditFromContext(ctx, 'core.role.adopted', {
		target: roleId,
		metadata: { name: role.name }
	});
}

/**
 * Reservierte Namen: Eine neue oder umbenannte Rolle darf keinen Standardrollen-Namen tragen, es sei denn,
 * sie ist selbst diese Standardrolle (409).
 */
export async function assertRoleNameAllowed(name: string, roleId?: string): Promise<void> {
	const trimmed = name.trim();
	if (!reservedDefaultRoleNames().has(trimmed)) return;
	if (roleId) {
		const [role] = await getDb()
			.select({ systemKey: schema.role.systemKey })
			.from(schema.role)
			.where(eq(schema.role.id, roleId));
		if (role?.systemKey === defaultRoleKey(trimmed)) return;
	}
	throw errors.conflict(t('permissions.roles.nameReserved', { name: trimmed }));
}
