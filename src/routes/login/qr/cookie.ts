import type { Cookies } from '@sveltejs/kit';

/** Cookie des anzeigenden Browsers: `<id>.<geheimnis>` (httpOnly, SameSite strict, nur für `/login/qr`) */
export const QR_COOKIE = 'atrium_qr';
/** Früherer Name – beim Lesen noch akzeptiert (Code gilt ohnehin nur wenige Minuten) */
export const LEGACY_QR_COOKIE = 'ep_qr';
export const QR_COOKIE_PATH = '/login/qr';

export function readQrCookie(cookies: Cookies): { id: string; secret: string } | null {
	const raw = cookies.get(QR_COOKIE) ?? cookies.get(LEGACY_QR_COOKIE) ?? '';
	const dot = raw.indexOf('.');
	return dot > 0 ? { id: raw.slice(0, dot), secret: raw.slice(dot + 1) } : null;
}

/** Beide Namen löschen (nach dem Einlösen) */
export function deleteQrCookie(cookies: Cookies): void {
	cookies.delete(QR_COOKIE, { path: QR_COOKIE_PATH });
	if (cookies.get(LEGACY_QR_COOKIE)) cookies.delete(LEGACY_QR_COOKIE, { path: QR_COOKIE_PATH });
}
