import type { Cookies } from '@sveltejs/kit';

/** Cookie des anzeigenden Browsers: `<id>.<geheimnis>` (httpOnly, SameSite strict, nur für `/login/qr`) */
export const QR_COOKIE = 'ep_qr';
export const QR_COOKIE_PATH = '/login/qr';

export function readQrCookie(cookies: Cookies): { id: string; secret: string } | null {
	const raw = cookies.get(QR_COOKIE) ?? '';
	const dot = raw.indexOf('.');
	return dot > 0 ? { id: raw.slice(0, dot), secret: raw.slice(dot + 1) } : null;
}
