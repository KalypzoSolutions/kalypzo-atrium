import { safeRedirect as safeRedirectCore } from '$lib/server/core/safe-redirect';

/** Wandelt Better-Auth-Fehler in eine anzeigbare deutsche Meldung um (ohne interne Details). */
export function authErrorMessage(e: unknown, fallback = 'Aktion fehlgeschlagen.'): string {
	const err = e as {
		status?: string | number;
		statusCode?: number;
		body?: { message?: string; code?: string };
	};
	const status = err?.statusCode ?? err?.status;
	const code = err?.body?.code ?? '';
	if (status === 429 || status === 'TOO_MANY_REQUESTS') {
		return 'Zu viele Versuche. Bitte später erneut versuchen.';
	}
	if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_PASSWORD') {
		return 'E-Mail oder Passwort ist falsch.';
	}
	if (code === 'EMAIL_NOT_VERIFIED') {
		return 'Bitte bestätige zuerst deine E-Mail-Adresse über den Link in der Bestätigungsmail.';
	}
	if (code === 'INVALID_TOKEN') return 'Der Link ist ungültig oder abgelaufen.';
	if (code === 'INVALID_TWO_FACTOR_COOKIE' || code === 'INVALID_CODE') {
		return 'Der Code ist ungültig oder abgelaufen.';
	}
	if (status === 403 || status === 'FORBIDDEN')
		return 'Zugriff nicht erlaubt (Konto deaktiviert?).';
	if (status === 401 || status === 'UNAUTHORIZED') return 'E-Mail oder Passwort ist falsch.';
	return fallback;
}

/**
 * Weiterleitungsziel nach dem Login: nur relative Pfade derselben Origin (Open-Redirect-Schutz über
 * den zentralen Helfer mit URL-Parser), nie zurück auf `/login`.
 */
export function safeRedirect(target: string | null | undefined, fallback = '/dashboard'): string {
	return safeRedirectCore(target, fallback, ['/login']);
}
