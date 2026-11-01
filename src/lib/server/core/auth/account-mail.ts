/**
 * Sprache für Mails an ein Konto (Passwort, E-Mail-Wechsel, Kontosperre, Bestätigung): die eigene
 * Einstellung `core.user.locale` der empfangenden Person, sonst `fallback` – bei selbst ausgelösten
 * Mails die Sprache des laufenden Requests, bei Mails aus der Verwaltung die Systemsprache.
 * Texte entstehen mit `withLocale(locale, () => sendMail({ … t(…) … }))`, damit auch das Mail-Layout
 * in dieser Sprache erscheint.
 */
import { getLocale, type Locale } from '$lib/i18n';
import { fallbackLocale, userLocale } from '../i18n/locale';

export async function accountMailLocale(
	userId: string | null | undefined,
	fallback: 'request' | 'system' = 'request'
): Promise<Locale> {
	const own = userId ? await userLocale(userId).catch(() => null) : null;
	if (own) return own;
	return fallback === 'request' ? getLocale() : fallbackLocale();
}
