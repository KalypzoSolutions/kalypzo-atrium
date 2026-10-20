import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuth } from '$lib/server/core/auth';
import { env } from '$lib/server/core/env';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const parsed = z.string().trim().email().max(255).safeParse(form.get('email'));
		if (!parsed.success) return fail(400, { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
		try {
			await getAuth().api.requestPasswordReset({
				body: { email: parsed.data, redirectTo: `${env().ORIGIN}/reset-password` },
				headers: request.headers
			});
		} catch {
			// Bewusst ignoriert: keine Auskunft, ob das Konto existiert
		}
		return { sent: true };
	}
};
