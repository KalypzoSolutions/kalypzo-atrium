import { error, fail, redirect } from '@sveltejs/kit';
import { decideQrLogin, inspectQrLogin } from '$lib/server/core/auth/qr-login';
import { isCoreError } from '$lib/server/core/errors';
import { describeUserAgent } from '$lib/user-agent';
import type { Actions, PageServerLoad } from './$types';

/**
 * Handy-Seite der QR-Anmeldung (Login nötig, Guard in `hooks.server.ts`). Zeigt Gerät, IP und Zeit der Anfrage;
 * bestätigt oder lehnt per Formular ab (Origin-Prüfung von SvelteKit gegen fremde Seiten).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) throw redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	let info;
	try {
		info = await inspectQrLogin(locals.ctx, params.token);
	} catch (e) {
		if (isCoreError(e)) throw error(e.status, e.message);
		throw e;
	}
	return {
		userName: locals.user.name,
		request: info
			? {
					status: info.status,
					device: describeUserAgent(info.userAgent),
					ip: info.ip,
					/** Gleiche öffentliche IP wie das Handy (z. B. gleiches WLAN) */
					sameNetwork: !!info.ip && info.ip === locals.ctx.ip,
					createdAt: info.createdAt,
					expiresAt: info.expiresAt
				}
			: null
	};
};

async function decide(locals: App.Locals, token: string, approve: boolean) {
	try {
		return { decided: await decideQrLogin(locals.ctx, token, approve) };
	} catch (e) {
		if (isCoreError(e)) return fail(e.status, { message: e.message });
		throw e;
	}
}

export const actions: Actions = {
	approve: ({ locals, params }) => decide(locals, params.token, true),
	deny: ({ locals, params }) => decide(locals, params.token, false)
};
