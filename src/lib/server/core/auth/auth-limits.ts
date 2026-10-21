import { env } from '../env';
import { hit, type RateLimitResult } from '../rate-limit';

/**
 * Gemeinsame Rate-Limits für alle Authentifizierungswege. Better Auth übernimmt sie als
 * `rateLimit.customRules` (HTTP-Weg `/api/auth/*`); die Form-Actions rufen `getAuth().api.*`
 * direkt auf und umgehen dessen Limiter – sie prüfen dieselben Werte über {@link limitAuthAction}.
 */
export const AUTH_RATE_LIMITS = {
	signIn: { path: '/sign-in/email', window: 60, max: 10 },
	passwordReset: { path: '/request-password-reset', window: 300, max: 5 },
	resetPassword: { path: '/reset-password', window: 300, max: 10 },
	verifyTotp: { path: '/two-factor/verify-totp', window: 60, max: 10 },
	changePassword: { path: '/change-password', window: 300, max: 5 },
	enableTwoFactor: { path: '/two-factor/enable', window: 300, max: 5 },
	disableTwoFactor: { path: '/two-factor/disable', window: 300, max: 5 },
	sendVerification: { path: '/send-verification-email', window: 300, max: 3 },
	changeEmail: { path: '/change-email', window: 300, max: 5 },
	updateUser: { path: '/update-user', window: 300, max: 20 }
} as const;

export type AuthLimitKind = keyof typeof AUTH_RATE_LIMITS;

/** `customRules` für Better Auth aus {@link AUTH_RATE_LIMITS}. */
export function betterAuthCustomRules(): Record<string, { window: number; max: number }> {
	const factor = env().AUTH_RATE_LIMIT_FACTOR;
	return Object.fromEntries(
		Object.values(AUTH_RATE_LIMITS).map((r) => [r.path, { window: r.window, max: r.max * factor }])
	);
}

/**
 * Zählt einen Versuch je IP und – falls angegeben – je Ziel (E-Mail, Konto, Token). Ist die IP schon
 * über dem Limit, wird das Ziel nicht mitgezählt. Ohne IP zählt ein gemeinsamer Eimer `unknown`.
 */
export function limitAuthAction(
	kind: AuthLimitKind,
	keys: { ip: string | null; target?: string | null }
): RateLimitResult {
	const rule = AUTH_RATE_LIMITS[kind];
	const max = rule.max * env().AUTH_RATE_LIMIT_FACTOR;
	const byIp = hit(`auth:${kind}:ip:${keys.ip ?? 'unknown'}`, max, rule.window);
	if (!byIp.allowed || !keys.target) return byIp;
	return hit(`auth:${kind}:target:${keys.target}`, max, rule.window);
}

/** Meldung bei überschrittenem Limit (Form-Actions). */
export const TOO_MANY_ATTEMPTS = 'Zu viele Versuche. Bitte später erneut versuchen.';

// --- Fehlversuchssperre beim Login ------------------------------------------

/** Sperre je (E-Mail, IP): 5 Fehlversuche in 15 min sperren nur diese IP für dieses Konto. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_SEC = 15 * 60;
/** Kontosperre für alle IPs erst bei deutlich mehr Fehlversuchen (verteilter Angriff). */
export const LOGIN_GLOBAL_MAX_FAILURES = 50;

export const loginPairKey = (email: string, ip: string | null) =>
	`login:${email}:${ip ?? 'unknown'}`;
export const loginGlobalKey = (email: string) => `login:${email}`;
