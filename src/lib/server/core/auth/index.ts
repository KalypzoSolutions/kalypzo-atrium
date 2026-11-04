import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { and, eq, ne } from 'drizzle-orm';
import { logAudit } from '../audit/service';
import { getDb, schema } from '../database/client';
import { env } from '../env';
import { withLocale } from '../i18n/locale';
import { sendMail } from '../mail';
import { maskEmail, maskEmailInput } from './mask-email';
import { peek, reset, hit } from '../rate-limit';
import { getSetting } from '../settings/service';
import {
	LOGIN_GLOBAL_MAX_FAILURES,
	LOGIN_MAX_FAILURES,
	LOGIN_WINDOW_SEC,
	betterAuthCustomRules,
	loginGlobalKey,
	loginPairKey
} from './auth-limits';
import { accountMailLocale } from './account-mail';
import { CLIENT_IP_HEADER, currentClientIp } from './client-ip';
import { qrLoginPlugin } from './qr-login-plugin';
import { t } from '$lib/i18n';

/** Payload eines Bestätigungs-Tokens (JWT) lesen, ohne Prüfung – nur zur Unterscheidung der Abläufe. */
function verificationPayload(token: string | null | undefined): {
	email?: string;
	updateTo?: string;
} {
	try {
		const payload = JSON.parse(
			Buffer.from(String(token ?? '').split('.')[1] ?? '', 'base64url').toString()
		);
		return payload && typeof payload === 'object' ? payload : {};
	} catch {
		return {};
	}
}

/**
 * Hinweis an die Kontoinhaber*in, wenn ein Konto wegen sehr vieler Fehlversuche (aus vielen IPs)
 * für alle gesperrt wird. Höchstens eine Mail je Sperrfenster; Fehler werden nur geloggt.
 */
async function notifyAccountLocked(email: string): Promise<void> {
	if (!hit(`login-locked-notice:${email}`, 1, LOGIN_WINDOW_SEC).allowed) return;
	try {
		const [u] = await getDb()
			.select({ id: schema.user.id, name: schema.user.name, active: schema.user.active })
			.from(schema.user)
			.where(eq(schema.user.email, email));
		if (!u?.active) return;
		const [name, locale] = await Promise.all([
			getSetting<string>('core.system.name'),
			accountMailLocale(u.id, 'system')
		]);
		await withLocale(locale, () =>
			sendMail({
				to: email,
				subject: t('account-mail.accountLocked.subject', { system: name }),
				text: t('account-mail.accountLocked.text', {
					name: u.name,
					minutes: LOGIN_WINDOW_SEC / 60
				})
			})
		);
	} catch (err) {
		console.error('[mail] Hinweis zur Kontosperre fehlgeschlagen:', (err as Error)?.message);
	}
}

function createAuth(opts: { sveltekitCookies: boolean }) {
	const e = env();
	const secure = e.ORIGIN.startsWith('https://');
	const plugins = [
		// Nur Beschriftung in der Authenticator-App; das Profil kann je Aufruf `issuer` (Systemname) mitgeben
		twoFactor({ issuer: 'Kalypzo Atrium' }),
		qrLoginPlugin(),
		...(opts.sveltekitCookies ? [sveltekitCookies(getRequestEvent)] : [])
	];

	return betterAuth({
		appName: 'Kalypzo Atrium',
		baseURL: e.ORIGIN,
		secret: e.APP_SECRET,
		database: drizzleAdapter(getDb(), {
			provider: 'pg',
			schema: {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification,
				twoFactor: schema.twoFactor
			}
		}),
		emailAndPassword: {
			enabled: true,
			disableSignUp: true, // Benutzer werden ausschließlich administrativ angelegt
			minPasswordLength: 12,
			maxPasswordLength: 128,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({ user, url }) => {
				const [name, locale] = await Promise.all([
					getSetting<string>('core.system.name'),
					accountMailLocale(user.id)
				]);
				// Fire-and-forget (Timing-Angleich); Fehler werden nicht an den Client gegeben
				void withLocale(locale, () =>
					sendMail({
						to: user.email,
						subject: t('account-mail.resetPassword.subject', { system: name }),
						text: t('account-mail.resetPassword.text', { name: user.name, url })
					})
				).catch((err) => console.error('[mail] Passwort-Reset fehlgeschlagen:', err?.message));
			},
			resetPasswordTokenExpiresIn: 60 * 60,
			// Eigenes Passwort gesetzt (Link aus „Passwort vergessen“, Verwaltung oder Einladung): Pflicht entfällt
			onPasswordReset: async ({ user }) => {
				await getDb()
					.update(schema.user)
					.set({ mustChangePassword: false })
					.where(eq(schema.user.id, user.id));
			}
		},
		emailVerification: {
			// Wird ausschließlich für den E-Mail-Wechsel genutzt (Link geht an die NEUE Adresse);
			// `requireEmailVerification` bleibt aus, Konten werden administrativ als verifiziert angelegt.
			expiresIn: 60 * 60,
			afterEmailVerification: async (user, request) => {
				// Alte Adresse aus dem (bereits geprüften) Token lesen; nur maskiert protokollieren
				let token = '';
				try {
					token = new URL(request?.url ?? '', 'http://x').searchParams.get('token') ?? '';
				} catch {
					/* ohne Angabe */
				}
				const payload = verificationPayload(token);
				if (!payload.updateTo) {
					// Bestätigung eines selbst registrierten Kontos (Verknüpfungsbrief): ab jetzt Anmeldung möglich
					await logAudit({
						action: 'core.auth.email_verified',
						actor: { type: 'user', id: user.id, name: maskEmail(user.email) },
						target: user.id,
						ip: currentClientIp(request?.headers)
					});
					return;
				}
				const from = typeof payload.email === 'string' ? maskEmail(payload.email) : '';
				// Nach dem Wechsel alle ANDEREN Sessions beenden (wie beim Admin-Pfad)
				let revoked = 0;
				try {
					const current = request
						? await getAuth().api.getSession({ headers: request.headers })
						: null;
					if (current?.session && current.user.id === user.id) {
						const gone = await getDb()
							.delete(schema.session)
							.where(
								and(eq(schema.session.userId, user.id), ne(schema.session.id, current.session.id))
							)
							.returning({ id: schema.session.id });
						revoked = gone.length;
					}
				} catch (err) {
					console.error('[auth] Sessions nach E-Mail-Wechsel nicht widerrufen:', err);
				}
				await logAudit({
					action: 'core.auth.email_changed',
					actor: { type: 'user', id: user.id, name: maskEmail(user.email) },
					target: user.id,
					metadata: { from, to: maskEmail(user.email), otherSessionsRevoked: revoked }
				});
			},
			sendVerificationEmail: async ({ user, url, token }) => {
				const [name, locale] = await Promise.all([
					getSetting<string>('core.system.name'),
					accountMailLocale(user.id)
				]);
				if (!verificationPayload(token).updateTo) {
					// Neues, selbst registriertes Konto: erst nach Bestätigung ist die Anmeldung möglich
					void withLocale(locale, () =>
						sendMail({
							to: user.email,
							subject: t('account-mail.verifyAccount.subject', { system: name }),
							text: t('account-mail.verifyAccount.text', { name: user.name, url })
						})
					).catch((err) => console.error('[mail] Kontobestätigung fehlgeschlagen:', err?.message));
					return;
				}
				void withLocale(locale, () =>
					sendMail({
						to: user.email,
						subject: t('account-mail.verifyNewEmail.subject', { system: name }),
						text: t('account-mail.verifyNewEmail.text', { name: user.name, url })
					})
				).catch((err) => console.error('[mail] E-Mail-Bestätigung fehlgeschlagen:', err?.message));
			}
		},
		user: {
			changeEmail: { enabled: true },
			additionalFields: {
				active: { type: 'boolean', defaultValue: true, input: false }
			}
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24
		},
		rateLimit: {
			enabled: true,
			window: 60,
			max: 100,
			storage: 'memory',
			// Gemeinsame Werte mit den Form-Actions (`auth-limits.ts`)
			customRules: betterAuthCustomRules()
		},
		advanced: {
			useSecureCookies: secure,
			// Nur der von `hooks.server.ts` gesetzte Header (= `event.getClientAddress()`), nie X-Forwarded-For
			ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
			defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure }
		},
		databaseHooks: {
			session: {
				create: {
					before: async (session) => {
						const [u] = await getDb()
							.select({
								active: schema.user.active,
								emailVerified: schema.user.emailVerified,
								email: schema.user.email
							})
							.from(schema.user)
							.where(eq(schema.user.id, session.userId));
						if (!u?.active) {
							throw new APIError('FORBIDDEN', { message: t('auth.accountDeactivated') });
						}
						// Selbst registrierte Konten erst nach Bestätigung der Adresse (greift nach der Passwortprüfung)
						if (!u.emailVerified) {
							// Neuer Bestätigungslink (höchstens einer je 5 min); das Passwort war richtig
							if (hit(`verify-resend:${session.userId}`, 1, 300).allowed) {
								void getAuth()
									.api.sendVerificationEmail({
										body: { email: u.email, callbackURL: '/login?verified=1' }
									})
									.catch((err) =>
										console.error('[auth] Bestätigungslink nicht versendet:', err?.message)
									);
							}
							throw new APIError('FORBIDDEN', {
								message: t('auth.emailNotVerified'),
								code: 'EMAIL_NOT_VERIFIED'
							});
						}
					}
				}
			}
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				// Profil-Änderungen laufen nur über die Server-Actions (`auth.api.*` ohne `request`):
				// E-Mail-Wechsel braucht dort Passwortprüfung, Rate-Limit und Hinweismail; Name/Bild
				// haben eigene Prüfungen. Der direkte HTTP-Weg würde das alles umgehen.
				if ((ctx.path === '/change-email' || ctx.path === '/update-user') && ctx.request) {
					throw new APIError('FORBIDDEN', {
						message: t('auth.profileOnly')
					});
				}
				// E-Mail-Wechsel-Link ohne gültige Session: keine Anmeldung über den Link (2FA-Umgehung).
				// Bestätigung eines neuen Kontos (Token ohne `updateTo`) erzeugt keine Session und bleibt offen.
				if (ctx.path === '/verify-email') {
					const token = (ctx.query as { token?: string } | undefined)?.token;
					if (!verificationPayload(token).updateTo) return;
					const session = await getSessionFromCtx(ctx);
					if (!session) throw ctx.redirect('/login');
					return;
				}
				if (ctx.path !== '/sign-in/email') return;
				const email = String((ctx.body as { email?: string } | undefined)?.email ?? '')
					.trim()
					.toLowerCase();
				const ip = currentClientIp(ctx.headers ?? ctx.request?.headers);
				// Sperre je (E-Mail, IP); für alle IPs erst ab der deutlich höheren globalen Schwelle
				const pair = email ? peek(loginPairKey(email, ip), LOGIN_WINDOW_SEC) : 0;
				const global = email ? peek(loginGlobalKey(email), LOGIN_WINDOW_SEC) : 0;
				if (pair >= LOGIN_MAX_FAILURES || global >= LOGIN_GLOBAL_MAX_FAILURES) {
					await logAudit({
						action: 'core.auth.login_blocked',
						actor: { type: 'user', id: null, name: maskEmailInput(email) },
						ip,
						metadata: {
							reason: 'too_many_failures',
							scope: global >= LOGIN_GLOBAL_MAX_FAILURES ? 'account' : 'ip'
						}
					});
					if (global >= LOGIN_GLOBAL_MAX_FAILURES) await notifyAccountLocked(email);
					throw new APIError('TOO_MANY_REQUESTS', {
						message: t('auth.tooManyFailedLogins')
					});
				}
			}),
			after: createAuthMiddleware(async (ctx) => {
				const ip = currentClientIp(ctx.headers ?? ctx.request?.headers);
				if (ctx.path === '/sign-in/email') {
					const email = String((ctx.body as { email?: string } | undefined)?.email ?? '')
						.trim()
						.toLowerCase();
					const session = ctx.context.newSession;
					if (session) {
						// Mit 2FA ist die Anmeldung erst mit dem Code vollständig (Protokoll und Zähler dort)
						if ((session.user as { twoFactorEnabled?: boolean | null }).twoFactorEnabled) return;
						reset(loginPairKey(email, ip));
						await logAudit({
							action: 'core.auth.login',
							actor: { type: 'user', id: session.user.id, name: maskEmail(session.user.email) },
							ip
						});
					} else if (email) {
						hit(loginPairKey(email, ip), 1000, LOGIN_WINDOW_SEC);
						hit(loginGlobalKey(email), 1000, LOGIN_WINDOW_SEC);
						await logAudit({
							action: 'core.auth.login_failed',
							actor: { type: 'user', id: null, name: maskEmailInput(email) },
							ip
						});
					}
				} else if (
					ctx.path === '/two-factor/verify-totp' ||
					ctx.path === '/two-factor/verify-backup-code'
				) {
					const session = ctx.context.newSession;
					if (session) {
						reset(loginPairKey(session.user.email.toLowerCase(), ip));
						await logAudit({
							action: 'core.auth.login',
							actor: { type: 'user', id: session.user.id, name: maskEmail(session.user.email) },
							ip,
							metadata: { twoFactor: true }
						});
					}
				} else if (ctx.path === '/sign-out') {
					await logAudit({
						action: 'core.auth.logout',
						actor: { type: 'user', id: null, name: '-' },
						ip
					});
				} else if (ctx.path === '/change-password' || ctx.path === '/reset-password') {
					const s = ctx.context.session ?? ctx.context.newSession;
					await logAudit({
						action: 'core.auth.password_changed',
						actor: {
							type: 'user',
							id: s?.user.id ?? null,
							name: s?.user.email ? maskEmail(s.user.email) : '-'
						},
						ip
					});
				}
			})
		},
		plugins
	});
}

export type Auth = ReturnType<typeof createAuth>;

const key = Symbol.for('atrium.auth');
type G = typeof globalThis & { [key]?: Auth };

/** Better-Auth-Instanz (Singleton). In Tests ohne SvelteKit-Request-Kontext aufrufbar. */
export function getAuth(): Auth {
	const g = globalThis as G;
	g[key] ??= createAuth({ sveltekitCookies: !process.env.VITEST });
	return g[key];
}

export function resetAuthForTests(): void {
	delete (globalThis as G)[key];
}
