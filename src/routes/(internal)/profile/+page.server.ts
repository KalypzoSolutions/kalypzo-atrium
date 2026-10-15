import { fail } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { getAuth } from '$lib/server/core/auth';
import { getSetting, setSetting } from '$lib/server/core/settings/service';
import { isCoreError } from '$lib/server/core/errors';
import { authErrorMessage } from '../../login/auth-error';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, request }) => {
	const userId = locals.user!.id;
	const sessions = await getAuth().api.listSessions({ headers: request.headers });
	const [theme, pageSize] = await Promise.all([
		getSetting<string>('core.user.theme', userId),
		getSetting<number>('core.user.pageSize', userId)
	]);
	return {
		profile: locals.user!,
		// Session-Tokens verlassen den Server nie; Widerruf erfolgt ueber die Session-ID
		sessions: sessions.map((s) => ({
			id: s.id,
			current: s.id === locals.sessionId,
			ipAddress: s.ipAddress ?? null,
			userAgent: s.userAgent ?? null,
			createdAt: s.createdAt,
			expiresAt: s.expiresAt
		})),
		settings: { theme, pageSize }
	};
};

const passwordSchema = z
	.string()
	.min(12, 'Das Passwort muss mindestens 12 Zeichen lang sein.')
	.max(128);

export const actions: Actions = {
	changePassword: async ({ request }) => {
		const f = await request.formData();
		const current = String(f.get('currentPassword') ?? '');
		const next = String(f.get('newPassword') ?? '');
		if (next !== String(f.get('confirm') ?? '')) {
			return fail(400, { section: 'password', error: 'Die Passwoerter stimmen nicht ueberein.' });
		}
		const p = passwordSchema.safeParse(next);
		if (!p.success) return fail(400, { section: 'password', error: p.error.issues[0]?.message });
		try {
			await getAuth().api.changePassword({
				body: {
					currentPassword: current,
					newPassword: next,
					revokeOtherSessions: f.get('revokeOthers') === 'on'
				},
				headers: request.headers
			});
		} catch (e) {
			return fail(400, {
				section: 'password',
				error: authErrorMessage(e, 'Passwort konnte nicht geaendert werden.')
			});
		}
		return { section: 'password', success: 'Passwort wurde geaendert.' };
	},

	enable2fa: async ({ request }) => {
		const f = await request.formData();
		try {
			const res = await getAuth().api.enableTwoFactor({
				body: { password: String(f.get('password') ?? ''), method: 'totp' },
				headers: request.headers
			});
			if (!('totpURI' in res)) {
				return fail(400, { section: '2fa', error: 'Aktivierung fehlgeschlagen.' });
			}
			return {
				section: '2fa',
				setup: {
					qr: await QRCode.toDataURL(res.totpURI, { margin: 1, width: 200 }),
					backupCodes: res.backupCodes as string[]
				}
			};
		} catch (e) {
			return fail(400, {
				section: '2fa',
				error: authErrorMessage(e, 'Aktivierung fehlgeschlagen.')
			});
		}
	},

	verify2fa: async ({ request }) => {
		const f = await request.formData();
		try {
			await getAuth().api.verifyTOTP({
				body: { code: String(f.get('code') ?? '').replace(/\s+/g, '') },
				headers: request.headers
			});
		} catch (e) {
			return fail(400, { section: '2fa', error: authErrorMessage(e, 'Code ungueltig.') });
		}
		return { section: '2fa', success: 'Zwei-Faktor-Authentifizierung ist aktiv.' };
	},

	disable2fa: async ({ request }) => {
		const f = await request.formData();
		try {
			await getAuth().api.disableTwoFactor({
				body: { password: String(f.get('password') ?? '') },
				headers: request.headers
			});
		} catch (e) {
			return fail(400, {
				section: '2fa',
				error: authErrorMessage(e, 'Deaktivierung fehlgeschlagen.')
			});
		}
		return { section: '2fa', success: 'Zwei-Faktor-Authentifizierung wurde deaktiviert.' };
	},

	revokeSession: async ({ request, locals }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const auth = getAuth();
		const sessions = await auth.api.listSessions({ headers: request.headers });
		const target = sessions.find((s) => s.id === id);
		if (!target || id === locals.sessionId) {
			return fail(400, { section: 'sessions', error: 'Session nicht gefunden.' });
		}
		await auth.api.revokeSession({ body: { token: target.token }, headers: request.headers });
		return { section: 'sessions', success: 'Session wurde beendet.' };
	},

	saveSettings: async ({ request, locals }) => {
		const f = await request.formData();
		try {
			await setSetting(locals.ctx, 'core.user.theme', String(f.get('theme') ?? 'system'));
			await setSetting(locals.ctx, 'core.user.pageSize', Number(f.get('pageSize') ?? 25));
		} catch (e) {
			return fail(400, {
				section: 'settings',
				error: isCoreError(e) ? e.message : 'Einstellungen konnten nicht gespeichert werden.'
			});
		}
		return { section: 'settings', success: 'Einstellungen gespeichert.' };
	}
};
