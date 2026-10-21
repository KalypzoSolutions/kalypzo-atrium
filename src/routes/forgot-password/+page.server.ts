import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuth } from '$lib/server/core/auth';
import { limitAuthAction } from '$lib/server/core/auth/auth-limits';
import { clientAddress, withClientIp } from '$lib/server/core/auth/client-ip';
import { env } from '$lib/server/core/env';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		const { request } = event;
		const form = await request.formData();
		const parsed = z.string().trim().email().max(255).safeParse(form.get('email'));
		if (!parsed.success) return fail(400, { error: 'Bitte eine gültige E-Mail-Adresse eingeben.' });
		const email = parsed.data.toLowerCase();
		const ip = clientAddress(event);
		// Je IP und je Adresse wie die Better-Auth-Regel; über dem Limit still verwerfen
		// (neutrale Antwort, keine Mail – kein Konto-Orakel, kein Mail-Bombing)
		if (!limitAuthAction('passwordReset', { ip, target: email }).allowed) return { sent: true };
		try {
			await getAuth().api.requestPasswordReset({
				body: { email, redirectTo: `${env().ORIGIN}/reset-password` },
				headers: withClientIp(request.headers, ip)
			});
		} catch {
			// Bewusst ignoriert: keine Auskunft, ob das Konto existiert
		}
		return { sent: true };
	}
};
