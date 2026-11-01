import { json } from '@sveltejs/kit';
import { t } from '$lib/i18n';
import { clientAddress } from '$lib/server/core/auth/client-ip';
import { createQrLogin, qrLoginStatus, QR_TTL_SEC } from '$lib/server/core/auth/qr-login';
import { isCoreError } from '$lib/server/core/errors';
import { qrDataUrl } from '$lib/server/core/qr';
import { QR_COOKIE, QR_COOKIE_PATH, readQrCookie } from './cookie';
import type { RequestHandler } from './$types';

/** Neuen QR-Code für diesen Browser anlegen (öffentlich, Login-Seite) */
export const POST: RequestHandler = async (event) => {
	if (event.locals.user) return json({ message: t('login.qr.alreadySignedIn') }, { status: 409 });
	try {
		const req = await createQrLogin({
			ip: clientAddress(event),
			userAgent: event.request.headers.get('user-agent')
		});
		const link = `${event.url.origin}/login/qr/${req.token}`;
		event.cookies.set(QR_COOKIE, `${req.id}.${req.secret}`, {
			path: QR_COOKIE_PATH,
			httpOnly: true,
			sameSite: 'strict',
			secure: event.url.protocol === 'https:',
			maxAge: QR_TTL_SEC + 120
		});
		return json({ qr: await qrDataUrl(link, { widthPx: 360 }), expiresAt: req.expiresAt });
	} catch (e) {
		if (isCoreError(e)) return json({ message: e.message }, { status: e.status });
		throw e;
	}
};

/** Stand für den anzeigenden Browser (Abfrage alle paar Sekunden) */
export const GET: RequestHandler = async ({ cookies }) => {
	const c = readQrCookie(cookies);
	const status = c ? await qrLoginStatus(c.id, c.secret) : null;
	return json({ status: status ?? 'expired' }, { headers: { 'cache-control': 'no-store' } });
};
