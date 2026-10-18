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
import { sendMail } from '../mail';
import { maskEmail } from './mask-email';
import { peek, reset, hit } from '../rate-limit';
import { getSetting } from '../settings/service';

/** Brute-Force-Schutz: pro Konto (E-Mail) und IP */
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_SEC = 15 * 60;

function createAuth(opts: { sveltekitCookies: boolean }) {
	const e = env();
	const secure = e.ORIGIN.startsWith('https://');
	const plugins = [
		twoFactor({ issuer: 'EP Intern' }),
		...(opts.sveltekitCookies ? [sveltekitCookies(getRequestEvent)] : [])
	];

	return betterAuth({
		appName: 'EP Intern',
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
				const name = await getSetting<string>('core.system.name');
				// Fire-and-forget (Timing-Angleich); Fehler werden nicht an den Client gegeben
				void sendMail({
					to: user.email,
					subject: `${name}: Passwort zurücksetzen`,
					text: `Hallo ${user.name},\n\nueber den folgenden Link können Sie Ihr Passwort zurücksetzen (1 Stunde gültig):\n${url}\n\nWenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht.`
				}).catch((err) => console.error('[mail] Passwort-Reset fehlgeschlagen:', err?.message));
			},
			resetPasswordTokenExpiresIn: 60 * 60
		},
		emailVerification: {
			// Wird ausschließlich für den E-Mail-Wechsel genutzt (Link geht an die NEUE Adresse);
			// `requireEmailVerification` bleibt aus, Konten werden administrativ als verifiziert angelegt.
			expiresIn: 60 * 60,
			afterEmailVerification: async (user, request) => {
				// Alte Adresse aus dem (bereits geprüften) Token lesen; nur maskiert protokollieren
				let from = '';
				try {
					const token = new URL(request?.url ?? '', 'http://x').searchParams.get('token') ?? '';
					const payload = JSON.parse(
						Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()
					);
					from = typeof payload.email === 'string' ? maskEmail(payload.email) : '';
				} catch {
					/* ohne Angabe */
				}
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
			sendVerificationEmail: async ({ user, url }) => {
				const name = await getSetting<string>('core.system.name');
				void sendMail({
					to: user.email,
					subject: `${name}: Neue E-Mail-Adresse bestätigen`,
					text: `Hallo ${user.name},

bitte bestätige mit dem folgenden Link, dass diese Adresse künftig für dein Konto gelten soll (1 Stunde gültig). Du musst dazu in diesem Browser angemeldet sein:
${url}

Wenn du das nicht angefordert hast, ignoriere diese Nachricht.`
				}).catch((err) => console.error('[mail] E-Mail-Bestätigung fehlgeschlagen:', err?.message));
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
			customRules: {
				'/sign-in/email': { window: 60, max: 10 },
				'/request-password-reset': { window: 300, max: 5 },
				'/two-factor/verify-totp': { window: 60, max: 10 },
				'/change-email': { window: 300, max: 5 },
				'/update-user': { window: 300, max: 20 }
			}
		},
		advanced: {
			useSecureCookies: secure,
			ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
			defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure }
		},
		databaseHooks: {
			session: {
				create: {
					before: async (session) => {
						const [u] = await getDb()
							.select({ active: schema.user.active })
							.from(schema.user)
							.where(eq(schema.user.id, session.userId));
						if (!u?.active) {
							throw new APIError('FORBIDDEN', { message: 'Konto ist deaktiviert' });
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
						message: 'Diese Änderung ist nur über das Profil möglich.'
					});
				}
				// Bestätigungslink ohne gültige Session: keine Anmeldung über den Link (2FA-Umgehung)
				if (ctx.path === '/verify-email') {
					const session = await getSessionFromCtx(ctx);
					if (!session) throw ctx.redirect('/login');
					return;
				}
				if (ctx.path !== '/sign-in/email') return;
				const email = String((ctx.body as { email?: string } | undefined)?.email ?? '')
					.trim()
					.toLowerCase();
				if (email && peek(`login:${email}`, LOGIN_WINDOW_SEC) >= LOGIN_MAX_FAILURES) {
					await logAudit({
						action: 'core.auth.login_blocked',
						actor: { type: 'user', id: null, name: email },
						metadata: { reason: 'too_many_failures' }
					});
					throw new APIError('TOO_MANY_REQUESTS', {
						message: 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte später erneut versuchen.'
					});
				}
			}),
			after: createAuthMiddleware(async (ctx) => {
				const ip = ctx.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
				if (ctx.path === '/sign-in/email') {
					const email = String((ctx.body as { email?: string } | undefined)?.email ?? '')
						.trim()
						.toLowerCase();
					const session = ctx.context.newSession;
					if (session) {
						reset(`login:${email}`);
						await logAudit({
							action: 'core.auth.login',
							actor: { type: 'user', id: session.user.id, name: session.user.email },
							ip
						});
					} else if (email) {
						hit(`login:${email}`, 1000, LOGIN_WINDOW_SEC);
						await logAudit({
							action: 'core.auth.login_failed',
							actor: { type: 'user', id: null, name: email },
							ip
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
						actor: { type: 'user', id: s?.user.id ?? null, name: s?.user.email ?? '-' },
						ip
					});
				}
			})
		},
		plugins
	});
}

export type Auth = ReturnType<typeof createAuth>;

const key = Symbol.for('ep-intern.auth');
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
