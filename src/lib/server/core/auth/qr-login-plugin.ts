/**
 * Better-Auth-Plugin für die QR-Anmeldung: legt nach `consumeQrLogin` eine normale Sitzung samt Cookie an
 * (gleiche Datenbank-Hooks wie beim Passwort-Login: deaktivierte/unbestätigte Konten → 403).
 * Nur serverseitig aufrufbar (`getAuth().api.qrLoginClaim`); der HTTP-Weg `/api/auth/qr-login/claim` ist gesperrt.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { currentClientIp } from './client-ip';
import { consumeQrLogin } from './qr-login';
import { t } from '$lib/i18n';

const invalid = () => t('auth.qrLoginInvalid');

export const qrLoginPlugin = () =>
	({
		id: 'ep-qr-login',
		endpoints: {
			qrLoginClaim: createAuthEndpoint(
				'/qr-login/claim',
				{
					method: 'POST',
					body: z.object({ id: z.string().max(64), secret: z.string().max(128) })
				},
				async (ctx) => {
					if (ctx.request) throw new APIError('NOT_FOUND');
					const ip = currentClientIp(ctx.headers);
					const userId = await consumeQrLogin(ctx.body.id, ctx.body.secret, { ip });
					if (!userId) throw new APIError('UNAUTHORIZED', { message: invalid() });
					const user = await ctx.context.internalAdapter.findUserById(userId);
					if (!user) throw new APIError('UNAUTHORIZED', { message: invalid() });
					const session = await ctx.context.internalAdapter.createSession(user.id);
					if (!session) throw new APIError('UNAUTHORIZED', { message: invalid() });
					await setSessionCookie(ctx, { session, user });
					return ctx.json({ ok: true });
				}
			)
		}
	}) satisfies BetterAuthPlugin;
