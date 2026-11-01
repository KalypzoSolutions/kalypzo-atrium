import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { t } from '$lib/i18n';
import { getAuth } from '$lib/server/core/auth';
import { clientAddress, withClientIp } from '$lib/server/core/auth/client-ip';
import { safeRedirect } from '../../auth-error';
import { deleteQrCookie, readQrCookie } from '../cookie';
import type { RequestHandler } from './$types';

const body = z.object({ redirectTo: z.string().max(2000).optional() }).catch({});

/**
 * Bestätigte QR-Anmeldung einlösen: nur mit dem Cookie des Browsers, der den Code angezeigt hat. Better Auth
 * legt die Sitzung an und setzt das Sitzungs-Cookie (über `sveltekitCookies`).
 */
export const POST: RequestHandler = async (event) => {
	const c = readQrCookie(event.cookies);
	const input = body.parse(await event.request.json().catch(() => ({})));
	const invalid = () => json({ message: t('login.qr.claimExpired') }, { status: 401 });
	if (!c) return invalid();
	try {
		await getAuth().api.qrLoginClaim({
			body: { id: c.id, secret: c.secret },
			headers: withClientIp(event.request.headers, clientAddress(event))
		});
	} catch (e) {
		const status = (e as { statusCode?: number })?.statusCode;
		if (status === 403) {
			return json({ message: t('login.errors.forbidden') }, { status: 403 });
		}
		return invalid();
	} finally {
		deleteQrCookie(event.cookies);
	}
	return json({ redirectTo: safeRedirect(input.redirectTo, '/') });
};
