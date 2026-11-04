/**
 * Sammelaktionen und CSV-Export für die Benutzerliste. Jede Zeile läuft durch dieselben Funktionen wie die
 * Einzelaktion (Rechte, `assertCanManageUser`, Audit je Konto); Fehler einzelner Konten brechen nicht ab.
 */
import type { RequestContext } from '$lib/sdk/types';
import { t } from '$lib/i18n';
import { csvDocument } from '$lib/sdk/csv';
import { auditFromContext } from '../../audit/service';
import { errors, isCoreError } from '../../errors';
import { requirePermission } from '../../permissions/service';
import {
	getUser,
	listUsers,
	updateUserFull,
	USER_IDS_MAX,
	type UserListFilter,
	type UserSort
} from '../users';
import { sendPasswordReset } from './password';
import { revokeUserSessions } from './sessions';

export const BULK_USER_ACTIONS = [
	'activate',
	'deactivate',
	'addRole',
	'removeRole',
	'sendReset',
	'revokeSessions'
] as const;
export type BulkUserAction = (typeof BULK_USER_ACTIONS)[number];

export interface BulkResult {
	ok: number;
	skipped: { id: string; name: string; reason: string }[];
}

export async function bulkUserAction(
	ctx: RequestContext,
	ids: string[],
	action: BulkUserAction,
	opts: { roleId?: string } = {}
): Promise<BulkResult> {
	await requirePermission(ctx, 'core.users.view');
	const unique = [...new Set(ids)].slice(0, USER_IDS_MAX);
	if (!unique.length) throw errors.badRequest(t('admin-users.server.noneSelected'));
	if ((action === 'addRole' || action === 'removeRole') && !opts.roleId) {
		throw errors.badRequest(t('auth.unknownRole'));
	}
	const result: BulkResult = { ok: 0, skipped: [] };
	for (const id of unique) {
		let name = id;
		try {
			const u = await getUser(ctx, id);
			name = u.name;
			switch (action) {
				case 'activate':
				case 'deactivate':
					if (id === ctx.userId) throw errors.badRequest(t('admin-users.server.notOnSelf'));
					if (u.active === (action === 'activate')) break;
					await updateUserFull(ctx, id, { active: action === 'activate' });
					break;
				case 'addRole':
				case 'removeRole': {
					const current = u.roles.map((r) => r.id);
					const next =
						action === 'addRole'
							? [...new Set([...current, opts.roleId!])]
							: current.filter((r) => r !== opts.roleId);
					if (next.length === current.length && next.every((r) => current.includes(r))) break;
					await updateUserFull(ctx, id, { roleIds: next });
					break;
				}
				case 'sendReset':
					await sendPasswordReset(ctx, id);
					break;
				case 'revokeSessions':
					await revokeUserSessions(ctx, id);
					break;
			}
			result.ok++;
		} catch (e) {
			if (!isCoreError(e)) throw e;
			result.skipped.push({ id, name, reason: e.message });
		}
	}
	await auditFromContext(ctx, 'core.user.bulk_action', {
		metadata: {
			action,
			roleId: opts.roleId ?? null,
			count: unique.length,
			ok: result.ok,
			skipped: result.skipped.length
		}
	});
	return result;
}

/** CSV aller Treffer (höchstens `USER_IDS_MAX`) – ohne Rechte-Details, mit Formelschutz. */
export async function exportUsersCsv(
	ctx: RequestContext,
	filter: UserListFilter & { sort?: UserSort }
): Promise<string> {
	const { items } = await listUsers(ctx, { ...filter, limit: 200, offset: 0 });
	const all = [...items];
	for (let offset = 200; all.length === offset && offset < USER_IDS_MAX; offset += 200) {
		const more = await listUsers(ctx, { ...filter, limit: 200, offset });
		all.push(...more.items);
	}
	await auditFromContext(ctx, 'core.user.exported', { metadata: { count: all.length } });
	const iso = (d: Date | null) => (d ? d.toISOString() : '');
	return csvDocument(
		[
			t('admin-users.csv.name'),
			t('admin-users.csv.email'),
			t('admin-users.csv.status'),
			t('admin-users.csv.roles'),
			t('admin-users.csv.twoFactor'),
			t('admin-users.csv.created'),
			t('admin-users.csv.lastLogin')
		],
		all.map((u) => [
			u.name,
			u.email,
			!u.active
				? t('admin-users.inactive')
				: !u.emailVerified
					? t('admin-users.unverified')
					: t('admin-users.active'),
			u.roles.map((r) => r.name).join(', '),
			u.twoFactorEnabled ? t('admin-users.yes') : t('admin-users.no'),
			iso(u.createdAt),
			iso(u.lastLoginAt)
		])
	);
}
