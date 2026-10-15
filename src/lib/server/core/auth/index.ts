import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { logAudit } from '../audit/service';
import { getDb, schema } from '../database/client';
import { env } from '../env';
import { sendMail } from '../mail';
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
			disableSignUp: true, // Benutzer werden ausschliesslich administrativ angelegt
			minPasswordLength: 12,
			maxPasswordLength: 128,
			revokeSessionsOnPasswordReset: true,
			sendResetPassword: async ({ user, url }) => {
				const name = await getSetting<string>('core.system.name');
				// Fire-and-forget (Timing-Angleich); Fehler werden nicht an den Client gegeben
				void sendMail({
					to: user.email,
					subject: `${name}: Passwort zuruecksetzen`,
					text: `Hallo ${user.name},\n\nueber den folgenden Link koennen Sie Ihr Passwort zuruecksetzen (1 Stunde gueltig):\n${url}\n\nWenn Sie das nicht angefordert haben, ignorieren Sie diese Nachricht.`
				}).catch((err) => console.error('[mail] Passwort-Reset fehlgeschlagen:', err?.message));
			},
			resetPasswordTokenExpiresIn: 60 * 60
		},
		user: {
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
				'/two-factor/verify-totp': { window: 60, max: 10 }
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
						message: 'Zu viele fehlgeschlagene Anmeldeversuche. Bitte spaeter erneut versuchen.'
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
