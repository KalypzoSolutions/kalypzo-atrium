import { error, fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '$lib/i18n';
import { listAudit } from '$lib/server/core/audit/service';
import { deleteUser, getUser, setUserActive, verifyUserEmail } from '$lib/server/core/auth/users';
import {
	createPasswordResetLink,
	PASSWORD_MAX,
	PASSWORD_MIN,
	sendInvitation,
	sendPasswordReset,
	setUserPassword
} from '$lib/server/core/auth/admin/password';
import {
	listUserSessions,
	resetTwoFactor,
	revokeUserSessions
} from '$lib/server/core/auth/admin/sessions';
import { explainUserPermissions, userStats } from '$lib/server/core/auth/admin/stats';
import {
	IMPERSONATION_MINUTES,
	impersonationsOf,
	startImpersonation
} from '$lib/server/core/auth/admin/impersonation';
import { canManageUser } from '$lib/server/core/auth/manage-guard';
import { isCoreError } from '$lib/server/core/errors';
import { getUserPermissions, isAdministrator } from '$lib/server/core/permissions/service';
import { CORE_PERMISSIONS } from '$lib/server/core/permissions/catalog';
import type { Actions, PageServerLoad } from './$types';

const ACTIVITY_PAGE = 25;

function toFail(e: unknown) {
	if (isCoreError(e)) {
		const field = (e.details as { path?: (string | number)[] }[] | undefined)?.[0]?.path?.[0];
		return fail(e.status, { message: e.message, field: typeof field === 'string' ? field : null });
	}
	throw e;
}

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const ctx = locals.ctx;
	if (!ctx.permissions.has('core.users.view')) throw error(403, t('admin-users.server.forbidden'));
	const user = await getUser(ctx, params.id).catch((e) => {
		if (isCoreError(e) && e.status === 404) throw error(404, e.message);
		throw e;
	});
	const self = user.id === ctx.userId;
	const manageable = await canManageUser(ctx, user.id);
	const stats = await userStats(ctx, user.id);
	const sessions = await listUserSessions(ctx, user.id);
	const permissions = await explainUserPermissions(ctx, user.id);
	const canAudit = ctx.permissions.has('core.audit.view');
	const apage = Math.max(1, Number(url.searchParams.get('apage') ?? 1) || 1);
	const activity = canAudit
		? await listAudit({
				involving: user.id,
				limit: ACTIVITY_PAGE,
				offset: (apage - 1) * ACTIVITY_PAGE
			})
		: null;
	const impersonations = await impersonationsOf(ctx, user.id, 10);
	const targetPerms = await getUserPermissions(user.id);
	const targetIsAdmin = Object.keys(CORE_PERMISSIONS).every((k) => targetPerms.has(k));
	return {
		user,
		self,
		manageable,
		stats,
		sessions: sessions.map((s) => ({
			...s,
			createdAt: s.createdAt.toISOString(),
			updatedAt: s.updatedAt.toISOString(),
			expiresAt: s.expiresAt.toISOString()
		})),
		permissions,
		activity: activity
			? {
					total: activity.total,
					page: apage,
					pageSize: ACTIVITY_PAGE,
					rows: activity.rows.map((r) => ({
						id: r.id,
						action: r.action,
						actorId: r.actorId,
						actorName: r.actorName,
						impersonatorId: r.impersonatorId,
						target: r.target,
						ip: r.ip,
						createdAt: r.createdAt.toISOString()
					}))
				}
			: null,
		impersonations: impersonations.map((i) => ({
			...i,
			startedAt: i.startedAt.toISOString(),
			expiresAt: i.expiresAt.toISOString(),
			endedAt: i.endedAt ? i.endedAt.toISOString() : null
		})),
		impersonationMinutes: [...IMPERSONATION_MINUTES],
		ownTwoFactor: locals.user?.twoFactorEnabled ?? false,
		can: {
			edit: ctx.permissions.has('core.users.edit') && manageable && !self,
			delete: ctx.permissions.has('core.users.delete') && manageable && !self,
			invite: ctx.permissions.has('core.users.create') && manageable && !self,
			impersonate:
				ctx.permissions.has('core.users.impersonate') &&
				manageable &&
				!self &&
				user.active &&
				!targetIsAdmin &&
				!locals.impersonation,
			audit: canAudit,
			isAdministrator: isAdministrator(ctx)
		},
		targetIsAdmin
	};
};

const idOnly = (fd: FormData) => z.string().min(1).max(64).safeParse(fd.get('id'));

export const actions: Actions = {
	sendReset: async ({ params, locals }) => {
		try {
			await sendPasswordReset(locals.ctx, params.id);
			return { success: true, message: t('admin-users.detail.server.resetSent') };
		} catch (e) {
			return toFail(e);
		}
	},

	resetLink: async ({ params, locals }) => {
		try {
			const { url, expiresAt } = await createPasswordResetLink(locals.ctx, params.id);
			return {
				success: true,
				link: url,
				expiresAt: expiresAt.toISOString(),
				message: t('admin-users.detail.server.linkCreated')
			};
		} catch (e) {
			return toFail(e);
		}
	},

	setPassword: async ({ request, params, locals }) => {
		const fd = await request.formData();
		const generate = fd.get('mode') === 'generate';
		const password = String(fd.get('password') ?? '');
		if (!generate && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
			return fail(422, { message: t('admin-users.server.passwordMin'), field: 'password' });
		}
		try {
			const res = await setUserPassword(locals.ctx, params.id, {
				generate,
				password: generate ? undefined : password,
				mustChange: fd.get('mustChange') === 'on'
			});
			return {
				success: true,
				generatedPassword: res.password ?? null,
				message: t('admin-users.detail.server.passwordSet')
			};
		} catch (e) {
			return toFail(e);
		}
	},

	invite: async ({ params, locals }) => {
		try {
			await sendInvitation(locals.ctx, params.id);
			return { success: true, message: t('admin-users.server.invited') };
		} catch (e) {
			return toFail(e);
		}
	},

	revokeSession: async ({ request, params, locals }) => {
		const fd = await request.formData();
		const sid = fd.get('sessionId');
		try {
			const n = await revokeUserSessions(
				locals.ctx,
				params.id,
				typeof sid === 'string' && sid ? sid : undefined
			);
			return {
				success: true,
				message: t('admin-users.detail.server.sessionsRevoked', { count: n })
			};
		} catch (e) {
			return toFail(e);
		}
	},

	resetTwoFactor: async ({ params, locals }) => {
		try {
			await resetTwoFactor(locals.ctx, params.id);
			return { success: true, message: t('admin-users.detail.server.twoFactorReset') };
		} catch (e) {
			return toFail(e);
		}
	},

	verifyEmail: async ({ params, locals }) => {
		try {
			await verifyUserEmail(locals.ctx, params.id);
			return { success: true, message: t('admin-users.server.emailVerified') };
		} catch (e) {
			return toFail(e);
		}
	},

	setActive: async ({ request, params, locals }) => {
		const fd = await request.formData();
		const active = fd.get('active') === 'true';
		try {
			await setUserActive(locals.ctx, params.id, active);
			return {
				success: true,
				message: active ? t('admin-users.server.activated') : t('admin-users.server.deactivated')
			};
		} catch (e) {
			return toFail(e);
		}
	},

	delete: async ({ request, params, locals }) => {
		const fd = await request.formData();
		const parsed = idOnly(fd);
		if (!parsed.success || parsed.data !== params.id) {
			return fail(422, { message: t('admin-users.server.userMissing') });
		}
		try {
			await deleteUser(locals.ctx, params.id);
		} catch (e) {
			return toFail(e);
		}
		throw redirect(303, '/admin/users');
	},

	impersonate: async ({ request, params, locals }) => {
		const fd = await request.formData();
		if (!locals.sessionId) return fail(401, { message: t('admin-users.server.forbidden') });
		try {
			await startImpersonation(locals.ctx, locals.sessionId, {
				targetUserId: params.id,
				reason: String(fd.get('reason') ?? ''),
				minutes: Number(fd.get('minutes') ?? 0),
				password: String(fd.get('password') ?? ''),
				totp: fd.get('totp') ? String(fd.get('totp')) : undefined
			});
		} catch (e) {
			return toFail(e);
		}
		// Ab jetzt läuft die Sitzung als Zielperson: neu laden auf deren Startseite
		throw redirect(303, '/');
	}
};
