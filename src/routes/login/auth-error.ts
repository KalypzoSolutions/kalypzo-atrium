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
	if (code === 'INVALID_TOKEN') return 'Der Link ist ungültig oder abgelaufen.';
	if (code === 'INVALID_TWO_FACTOR_COOKIE' || code === 'INVALID_CODE') {
		return 'Der Code ist ungültig oder abgelaufen.';
	}
	if (status === 403 || status === 'FORBIDDEN')
		return 'Zugriff nicht erlaubt (Konto deaktiviert?).';
	if (status === 401 || status === 'UNAUTHORIZED') return 'E-Mail oder Passwort ist falsch.';
	return fallback;
}

/** Nur relative Pfade derselben Origin zulassen (Open-Redirect-Schutz). */
export function safeRedirect(target: string | null | undefined, fallback = '/dashboard'): string {
	if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
		return fallback;
	}
	if (target.startsWith('/login')) return fallback;
	return target;
}
