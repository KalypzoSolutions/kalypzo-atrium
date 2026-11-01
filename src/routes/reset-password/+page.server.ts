import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '$lib/i18n';
import { getAuth } from '$lib/server/core/auth';
import { limitAuthAction } from '$lib/server/core/auth/auth-limits';
import { clientAddress, withClientIp } from '$lib/server/core/auth/client-ip';
import { authErrorMessage } from '../login/auth-error';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({ token: url.searchParams.get('token') ?? '' });

export const actions: Actions = {
	default: async (event) => {
		const { request } = event;
		const form = await request.formData();
		const token = String(form.get('token') ?? '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		if (!token) return fail(400, { error: t('password.reset.invalidLink') });
		const parsed = z.string().min(12, t('password.reset.tooShort')).max(128).safeParse(password);
		if (!parsed.success)
			return fail(400, { error: parsed.error.issues[0]?.message ?? t('password.reset.invalid') });
		if (password !== confirm) return fail(400, { error: t('password.reset.mismatch') });
		const ip = clientAddress(event);
		if (!limitAuthAction('resetPassword', { ip, target: token.slice(0, 200) }).allowed) {
			return fail(429, { error: t('password.tooMany') });
		}
		try {
			await getAuth().api.resetPassword({
				body: { newPassword: password, token },
				headers: withClientIp(request.headers, ip)
			});
		} catch (e) {
			return fail(400, { error: authErrorMessage(e, t('password.reset.failed')) });
		}
		return { done: true };
	}
};
