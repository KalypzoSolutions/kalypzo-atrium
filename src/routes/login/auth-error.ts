import { t } from '$lib/i18n';
import { safeRedirect as safeRedirectCore } from '$lib/server/core/safe-redirect';

/** Wandelt Better-Auth-Fehler in eine anzeigbare Meldung um (ohne interne Details). */
export function authErrorMessage(e: unknown, fallback = t('login.errors.actionFailed')): string {
	const err = e as {
		status?: string | number;
		statusCode?: number;
		body?: { message?: string; code?: string };
	};
	const status = err?.statusCode ?? err?.status;
	const code = err?.body?.code ?? '';
	if (status === 429 || status === 'TOO_MANY_REQUESTS') {
		return t('login.errors.tooMany');
	}
	if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PASSWORD') {
		return t('login.errors.wrongCredentials');
	}
	if (code === 'EMAIL_NOT_VERIFIED') {
		return t('login.errors.emailNotVerified');
	}
	if (code === 'INVALID_TOKEN') return t('login.errors.invalidToken');
	if (code === 'INVALID_TWO_FACTOR_COOKIE' || code === 'INVALID_CODE') {
		return t('login.errors.invalidCode');
	}
	if (status === 403 || status === 'FORBIDDEN') return t('login.errors.forbidden');
	if (status === 401 || status === 'UNAUTHORIZED') return t('login.errors.wrongCredentials');
	return fallback;
}

/**
 * Weiterleitungsziel nach dem Login: nur relative Pfade derselben Origin (Open-Redirect-Schutz über
 * den zentralen Helfer mit URL-Parser), nie zurück auf `/login`.
 */
export function safeRedirect(target: string | null | undefined, fallback = '/dashboard'): string {
	return safeRedirectCore(target, fallback, ['/login']);
}
