import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuth } from '$lib/server/core/auth';
import { authErrorMessage } from '../login/auth-error';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => ({ token: url.searchParams.get('token') ?? '' });

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		if (!token) return fail(400, { error: 'Der Link ist ungültig oder abgelaufen.' });
		const parsed = z
			.string()
			.min(12, 'Das Passwort muss mindestens 12 Zeichen lang sein.')
			.max(128)
			.safeParse(password);
		if (!parsed.success)
			return fail(400, { error: parsed.error.issues[0]?.message ?? 'Ungültiges Passwort.' });
		if (password !== confirm) return fail(400, { error: 'Die Passwörter stimmen nicht überein.' });
		try {
			await getAuth().api.resetPassword({
				body: { newPassword: password, token },
				headers: request.headers
			});
		} catch (e) {
			return fail(400, { error: authErrorMessage(e, 'Zurücksetzen fehlgeschlagen.') });
		}
		return { done: true };
	}
};
