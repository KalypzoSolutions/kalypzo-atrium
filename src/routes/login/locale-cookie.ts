import type { Cookies } from '@sveltejs/kit';
import { isLocale, type Locale } from '$lib/i18n';
import { LOCALE_COOKIE } from '$lib/server/core/i18n/locale';

const ONE_YEAR_SEC = 60 * 60 * 24 * 365;

/**
 * Sprach-Cookie setzen (Login, öffentliche Seiten, Profil). Leer bzw. unbekannt → Cookie löschen,
 * dann gilt wieder die Konto- oder Systemsprache.
 */
export function setLocaleCookie(cookies: Cookies, value: unknown, secure: boolean): Locale | null {
	if (isLocale(value)) {
		cookies.set(LOCALE_COOKIE, value, {
			path: '/',
			sameSite: 'lax',
			httpOnly: true,
			secure,
			maxAge: ONE_YEAR_SEC
		});
		return value;
	}
	cookies.delete(LOCALE_COOKIE, { path: '/' });
	return null;
}
