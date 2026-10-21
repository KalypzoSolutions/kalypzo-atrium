import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuth } from '$lib/server/core/auth';
import { getSettings } from '$lib/server/core/settings/service';
import { limitAuthAction, TOO_MANY_ATTEMPTS } from '$lib/server/core/auth/auth-limits';
import { clientAddress, withClientIp } from '$lib/server/core/auth/client-ip';
import { authErrorMessage, safeRedirect } from './auth-error';
import type { Actions, PageServerLoad } from './$types';

/** Ohne `redirectTo` geht es auf `/` (leitet auf die persönliche Startseite). */
function target(url: URL): string {
	const r = url.searchParams.get('redirectTo');
	return r ? safeRedirect(r) : '/';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) throw redirect(303, target(url));
	// Rechtliche Links für die Fußzeile (Issue #28)
	const legal = await getSettings(['core.legal.privacyUrl', 'core.legal.imprintUrl']);
	const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
	return {
		redirectTo: safeRedirect(url.searchParams.get('redirectTo')),
		legal: {
			privacyUrl: text(legal['core.legal.privacyUrl']),
			imprintUrl: text(legal['core.legal.imprintUrl'])
		}
	};
};

const credentials = z.object({
	email: z.string().trim().email().max(255),
	password: z.string().min(1).max(128)
});

/** Kennung der laufenden 2FA-Anmeldung (signiertes Cookie von Better Auth) als Ziel fürs Limit. */
function twoFactorCookie(headers: Headers): string | null {
	const m = /(?:^|;\s*)(?:__Secure-)?better-auth\.two_factor=([^;]+)/.exec(
		headers.get('cookie') ?? ''
	);
	return m?.[1]?.slice(0, 200) ?? null;
}

export const actions: Actions = {
	login: async (event) => {
		const { request, url } = event;
		const form = await request.formData();
		const parsed = credentials.safeParse({
			email: form.get('email'),
			password: form.get('password')
		});
		const email = String(form.get('email') ?? '');
		if (!parsed.success) return fail(400, { error: 'Bitte E-Mail und Passwort eingeben.', email });
		// Form-Actions umgehen den Limiter von Better Auth: gleiche Werte je IP (Sperre je
		// E-Mail+IP und die globale Kontosperre prüft der Better-Auth-Hook)
		const ip = clientAddress(event);
		if (!limitAuthAction('signIn', { ip }).allowed) {
			return fail(429, { error: TOO_MANY_ATTEMPTS, email });
		}
		try {
			const res = await getAuth().api.signInEmail({
				body: parsed.data,
				headers: withClientIp(request.headers, ip)
			});
			if (res && 'twoFactorRedirect' in res && res.twoFactorRedirect) {
				return { twoFactor: true, email };
			}
		} catch (e) {
			return fail(400, { error: authErrorMessage(e, 'Anmeldung fehlgeschlagen.'), email });
		}
		throw redirect(303, target(url));
	},

	verify: async (event) => {
		const { request, url } = event;
		const form = await request.formData();
		const code = String(form.get('code') ?? '').replace(/\s+/g, '');
		if (!/^\d{6}$/.test(code)) {
			return fail(400, { twoFactor: true, error: 'Bitte den 6-stelligen Code eingeben.' });
		}
		const ip = clientAddress(event);
		const limited = limitAuthAction('verifyTotp', {
			ip,
			target: twoFactorCookie(request.headers)
		});
		if (!limited.allowed) return fail(429, { twoFactor: true, error: TOO_MANY_ATTEMPTS });
		try {
			await getAuth().api.verifyTOTP({
				body: { code },
				headers: withClientIp(request.headers, ip)
			});
		} catch (e) {
			return fail(400, { twoFactor: true, error: authErrorMessage(e, 'Code ungültig.') });
		}
		throw redirect(303, target(url));
	}
};
