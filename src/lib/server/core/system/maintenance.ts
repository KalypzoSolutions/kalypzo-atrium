/**
 * Gemeinsame Bausteine für Wartungsvorgänge (Zurücksetzen, Datensicherung):
 * prozessweite Sperre (nur ein Vorgang gleichzeitig) und erneute Anmeldung (Passwort + ggf. TOTP).
 */
import { eq } from 'drizzle-orm';
import { verifyUserPassword } from '../auth/profile';
import { getDb, schema } from '../database/client';
import { errors } from '../errors';
import { hit, peek, reset as resetRateLimit } from '../rate-limit';
import { verifyTotp } from './reset';

let running: string | null = null;

/** Sperre holen; läuft schon ein Vorgang → 409 mit dessen Bezeichnung. */
export function acquireMaintenanceLock(label: string): void {
	if (running) throw errors.conflict(`Es läuft bereits ein Wartungsvorgang (${running})`);
	running = label;
}

export function releaseMaintenanceLock(): void {
	running = null;
}

export function maintenanceRunning(): string | null {
	return running;
}

const TOTP_WINDOW_SEC = 10 * 60;
const TOTP_MAX_FAILURES = 5;
const PASSWORD_MAX_FAILURES = 10;

/**
 * Passwort und – bei aktivierter 2FA – TOTP prüfen. Fehler → 422 mit Feldpfad `password` bzw. `totp`.
 * `rateKey` trennt die Zähler je Vorgang (z. B. `backup`).
 */
export async function verifyReauth(
	userId: string,
	input: { password: string; totp?: string },
	rateKey: string
): Promise<void> {
	const pwKey = `${rateKey}pw:${userId}`;
	if (peek(pwKey, TOTP_WINDOW_SEC) >= PASSWORD_MAX_FAILURES) {
		throw errors.badRequest('Zu viele Versuche. Bitte später erneut versuchen.');
	}
	if (!(await verifyUserPassword(userId, String(input.password ?? '')))) {
		hit(pwKey, 1000, TOTP_WINDOW_SEC);
		throw errors.validation([{ path: ['password'], message: 'Passwort ist nicht korrekt' }]);
	}
	resetRateLimit(pwKey);
	const [u] = await getDb()
		.select({ twoFactorEnabled: schema.user.twoFactorEnabled })
		.from(schema.user)
		.where(eq(schema.user.id, userId));
	if (!u?.twoFactorEnabled) return;
	const key = `${rateKey}totp:${userId}`;
	if (peek(key, TOTP_WINDOW_SEC) >= TOTP_MAX_FAILURES) {
		throw errors.badRequest('Zu viele Versuche. Bitte später erneut versuchen.');
	}
	const code = String(input.totp ?? '').replace(/\s+/g, '');
	if (!(await verifyTotp(userId, code))) {
		hit(key, 1000, TOTP_WINDOW_SEC);
		throw errors.validation([
			{ path: ['totp'], message: 'Bestätigungscode (2FA) fehlt oder ist ungültig' }
		]);
	}
	resetRateLimit(key);
}
