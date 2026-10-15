import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuth } from '$lib/server/core/auth';
import { authErrorMessage, safeRedirect } from './auth-error';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) throw redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	return { redirectTo: safeRedirect(url.searchParams.get('redirectTo')) };
};

const credentials = z.object({
	email: z.string().trim().email().max(255),
	password: z.string().min(1).max(128)
});

export const actions: Actions = {
	login: async ({ request, url }) => {
		const form = await request.formData();
		const parsed = credentials.safeParse({
			email: form.get('email'),
			password: form.get('password')
		});
		const email = String(form.get('email') ?? '');
		if (!parsed.success) return fail(400, { error: 'Bitte E-Mail und Passwort eingeben.', email });
		try {
			const res = await getAuth().api.signInEmail({
				body: parsed.data,
				headers: request.headers
			});
			if (res && 'twoFactorRedirect' in res && res.twoFactorRedirect) {
				return { twoFactor: true, email };
			}
		} catch (e) {
			return fail(400, { error: authErrorMessage(e, 'Anmeldung fehlgeschlagen.'), email });
		}
		throw redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	},

	verify: async ({ request, url }) => {
		const form = await request.formData();
		const code = String(form.get('code') ?? '').replace(/\s+/g, '');
		if (!/^\d{6}$/.test(code)) {
			return fail(400, { twoFactor: true, error: 'Bitte den 6-stelligen Code eingeben.' });
		}
		try {
			await getAuth().api.verifyTOTP({ body: { code }, headers: request.headers });
		} catch (e) {
			return fail(400, { twoFactor: true, error: authErrorMessage(e, 'Code ungueltig.') });
		}
		throw redirect(303, safeRedirect(url.searchParams.get('redirectTo')));
	}
};
