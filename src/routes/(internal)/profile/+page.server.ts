import { fail } from '@sveltejs/kit';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import QRCode from 'qrcode';
import { z } from 'zod';
import { getAuth } from '$lib/server/core/auth';
import {
	AVATAR_MAX_BYTES,
	removeOwnAvatar,
	requestEmailChange,
	setOwnAvatar,
	updateOwnName
} from '$lib/server/core/auth/profile';
import { getDb, schema } from '$lib/server/core/database/client';
import { isCoreError } from '$lib/server/core/errors';
import { navigationFor } from '$lib/server/core/modules/service';
import { enabledModuleIds } from '$lib/server/core/modules/state';
import { setSetting } from '$lib/server/core/settings/service';
import { loadUserPrefs, resolveStartPage } from '$lib/server/core/settings/user-prefs';
import { authErrorMessage } from '../../login/auth-error';
import type { Actions, PageServerLoad } from './$types';

/**
 * Aktive Sitzungen des Benutzers direkt aus der Datenbank. `api.listSessions` verlangt eine
 * *frische* Sitzung (`freshAge`, Standard 1 Tag) und wirft sonst „Session is not fresh“ – die
 * Seite wuerde fuer jede aeltere Anmeldung mit 500 abbrechen.
 */
function listOwnSessions(userId: string) {
	return getDb()
		.select({
			id: schema.session.id,
			token: schema.session.token,
			ipAddress: schema.session.ipAddress,
			userAgent: schema.session.userAgent,
			createdAt: schema.session.createdAt,
			expiresAt: schema.session.expiresAt
		})
		.from(schema.session)
		.where(and(eq(schema.session.userId, userId), gt(schema.session.expiresAt, new Date())))
		.orderBy(desc(schema.session.createdAt));
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const canApiKeys = locals.ctx.permissions.has('core.api.manage');
	const [sessions, prefs, nav, enabled, [dbUser], roles, apiKeys] = await Promise.all([
		listOwnSessions(userId),
		loadUserPrefs(userId),
		navigationFor(locals.ctx),
		enabledModuleIds(),
		getDb()
			.select({ createdAt: schema.user.createdAt, emailVerified: schema.user.emailVerified })
			.from(schema.user)
			.where(eq(schema.user.id, userId)),
		getDb()
			.select({ name: schema.role.name })
			.from(schema.userRole)
			.innerJoin(schema.role, eq(schema.role.id, schema.userRole.roleId))
			.where(eq(schema.userRole.userId, userId))
			.orderBy(schema.role.name),
		canApiKeys
			? getDb()
					.select({
						name: schema.apiKey.name,
						prefix: schema.apiKey.prefix,
						lastUsedAt: schema.apiKey.lastUsedAt
					})
					.from(schema.apiKey)
					.where(and(eq(schema.apiKey.ownerId, userId), isNull(schema.apiKey.revokedAt)))
					.orderBy(desc(schema.apiKey.createdAt))
					.limit(3)
			: Promise.resolve([])
	]);
	const startPage = resolveStartPage(
		prefs.startPage,
		nav.map((n) => n.path)
	);
	const userPrefs = {
		theme: prefs.theme,
		pageSize: prefs.pageSize,
		accentColor: prefs.accentColor,
		density: prefs.density,
		startPage
	};
	return {
		profile: locals.user!,
		createdAt: dbUser?.createdAt ?? null,
		emailVerified: dbUser?.emailVerified ?? false,
		roles: roles.map((r) => r.name),
		// Session-Tokens verlassen den Server nie; Widerruf erfolgt ueber die Session-ID
		sessions: sessions.map((s) => ({
			id: s.id,
			current: s.id === locals.sessionId,
			ipAddress: s.ipAddress ?? null,
			userAgent: s.userAgent ?? null,
			createdAt: s.createdAt,
			expiresAt: s.expiresAt
		})),
		/** Eigene, nicht widerrufene API-Keys (hoechstens 3; leer ohne Recht `core.api.manage`) */
		apiKeys,
		/** Einstellungen (Alias `settings` fuer aeltere Aufrufer) */
		userPrefs,
		settings: userPrefs,
		/** Auswahl fuer die Startseite: Dashboard, Profil und Modul-Navigation (nach Rechten) */
		startPageOptions: [
			{ value: '/dashboard', label: 'Dashboard' },
			{ value: '/profile', label: 'Profil' },
			...nav.map((n) => ({ value: n.path, label: n.label }))
		],
		/** IDs aktiver Module (fuer `profileSections` in `+page.ts`) */
		activeModules: [...enabled].sort(),
		permissions: [...locals.ctx.permissions].sort()
	};
};

const passwordSchema = z
	.string()
	.min(12, 'Das Passwort muss mindestens 12 Zeichen lang sein.')
	.max(128);

const THEME_COOKIE_AGE = 60 * 60 * 24 * 365;

export const actions: Actions = {
	changePassword: async ({ request }) => {
		const f = await request.formData();
		const current = String(f.get('currentPassword') ?? '');
		const next = String(f.get('newPassword') ?? '');
		if (next !== String(f.get('confirm') ?? '')) {
			return fail(400, { section: 'password', error: 'Die Passwoerter stimmen nicht ueberein.' });
		}
		const p = passwordSchema.safeParse(next);
		if (!p.success) return fail(400, { section: 'password', error: p.error.issues[0]?.message });
		try {
			await getAuth().api.changePassword({
				body: {
					currentPassword: current,
					newPassword: next,
					revokeOtherSessions: f.get('revokeOthers') === 'on'
				},
				headers: request.headers
			});
		} catch (e) {
			return fail(400, {
				section: 'password',
				error: authErrorMessage(e, 'Passwort konnte nicht geaendert werden.')
			});
		}
		return { section: 'password', success: 'Passwort wurde geaendert.' };
	},

	enable2fa: async ({ request }) => {
		const f = await request.formData();
		try {
			const res = await getAuth().api.enableTwoFactor({
				body: { password: String(f.get('password') ?? ''), method: 'totp' },
				headers: request.headers
			});
			if (!('totpURI' in res)) {
				return fail(400, { section: '2fa', error: 'Aktivierung fehlgeschlagen.' });
			}
			return {
				section: '2fa',
				setup: {
					qr: await QRCode.toDataURL(res.totpURI, { margin: 1, width: 200 }),
					backupCodes: res.backupCodes as string[]
				}
			};
		} catch (e) {
			return fail(400, {
				section: '2fa',
				error: authErrorMessage(e, 'Aktivierung fehlgeschlagen.')
			});
		}
	},

	verify2fa: async ({ request }) => {
		const f = await request.formData();
		try {
			await getAuth().api.verifyTOTP({
				body: { code: String(f.get('code') ?? '').replace(/\s+/g, '') },
				headers: request.headers
			});
		} catch (e) {
			return fail(400, { section: '2fa', error: authErrorMessage(e, 'Code ungueltig.') });
		}
		return { section: '2fa', success: 'Zwei-Faktor-Authentifizierung ist aktiv.' };
	},

	disable2fa: async ({ request }) => {
		const f = await request.formData();
		try {
			await getAuth().api.disableTwoFactor({
				body: { password: String(f.get('password') ?? '') },
				headers: request.headers
			});
		} catch (e) {
			return fail(400, {
				section: '2fa',
				error: authErrorMessage(e, 'Deaktivierung fehlgeschlagen.')
			});
		}
		return { section: '2fa', success: 'Zwei-Faktor-Authentifizierung wurde deaktiviert.' };
	},

	revokeSession: async ({ request, locals }) => {
		const f = await request.formData();
		const id = String(f.get('id') ?? '');
		const auth = getAuth();
		const sessions = await listOwnSessions(locals.user!.id);
		const target = sessions.find((s) => s.id === id);
		if (!target || id === locals.sessionId) {
			return fail(400, { section: 'sessions', error: 'Session nicht gefunden.' });
		}
		await auth.api.revokeSession({ body: { token: target.token }, headers: request.headers });
		return { section: 'sessions', success: 'Session wurde beendet.' };
	},

	revokeOtherSessions: async ({ request }) => {
		try {
			await getAuth().api.revokeOtherSessions({ headers: request.headers });
		} catch (e) {
			return fail(400, {
				section: 'sessions',
				error: authErrorMessage(e, 'Sessions konnten nicht beendet werden.')
			});
		}
		return { section: 'sessions', success: 'Alle anderen Sessions wurden beendet.' };
	},

	saveSettings: async ({ request, locals, cookies, url }) => {
		const f = await request.formData();
		try {
			// Nur mitgesendete Felder werden gespeichert (jede Karte sendet ihre eigenen)
			if (f.has('theme')) {
				const theme = String(f.get('theme'));
				await setSetting(locals.ctx, 'core.user.theme', theme);
				cookies.set('theme', theme, {
					path: '/',
					maxAge: THEME_COOKIE_AGE,
					sameSite: 'lax',
					httpOnly: false,
					secure: url.protocol === 'https:'
				});
			}
			if (f.has('pageSize')) {
				await setSetting(locals.ctx, 'core.user.pageSize', Number(f.get('pageSize')));
			}
			if (f.has('accentColor')) {
				await setSetting(locals.ctx, 'core.user.accentColor', String(f.get('accentColor')));
			}
			if (f.has('density')) {
				await setSetting(locals.ctx, 'core.user.density', String(f.get('density')));
			}
			if (f.has('startPage')) {
				// Nur erlaubte Seiten (Dashboard, Profil, Modul-Navigation); sonst Dashboard
				const nav = await navigationFor(locals.ctx);
				const page = resolveStartPage(
					String(f.get('startPage')),
					nav.map((n) => n.path)
				);
				await setSetting(locals.ctx, 'core.user.startPage', page);
			}
		} catch (e) {
			return fail(400, {
				section: 'settings',
				error: isCoreError(e) ? e.message : 'Einstellungen konnten nicht gespeichert werden.'
			});
		}
		return { section: 'settings', success: 'Einstellungen gespeichert.' };
	},

	updateName: async ({ request, locals }) => {
		const f = await request.formData();
		try {
			await updateOwnName(locals.ctx, String(f.get('name') ?? ''));
		} catch (e) {
			return fail(400, {
				section: 'account',
				error: isCoreError(e) ? e.message : 'Name konnte nicht geaendert werden.'
			});
		}
		return { section: 'account', success: 'Name wurde gespeichert.' };
	},

	changeEmail: async ({ request, locals }) => {
		const f = await request.formData();
		const parsed = z
			.object({
				newEmail: z
					.string()
					.trim()
					.toLowerCase()
					.max(255)
					.pipe(z.email('Bitte eine gueltige E-Mail-Adresse eingeben.')),
				password: z.string().min(1, 'Bitte das Passwort eingeben.').max(128)
			})
			.safeParse({ newEmail: f.get('newEmail'), password: f.get('password') });
		if (!parsed.success) {
			return fail(400, { section: 'email', error: parsed.error.issues[0]?.message });
		}
		try {
			await requestEmailChange(locals.ctx, request.headers, parsed.data);
		} catch (e) {
			return fail(400, {
				section: 'email',
				error: isCoreError(e)
					? e.message
					: authErrorMessage(e, 'Die Aenderung konnte nicht angefragt werden.')
			});
		}
		// Neutrale Antwort: unabhaengig davon, ob die Adresse bereits vergeben ist
		return {
			section: 'email',
			success:
				'Wir haben einen Bestätigungslink an die neue Adresse gesendet. Die Adresse ändert sich erst nach Klick auf den Link (1 Stunde gültig).'
		};
	},

	setAvatar: async ({ request, locals }) => {
		const f = await request.formData();
		const file = f.get('avatar');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { section: 'avatar', error: 'Bitte ein Bild auswaehlen.' });
		}
		// Groesse vor dem Einlesen pruefen (kein Puffern ueberlanger Uploads)
		if (file.size > AVATAR_MAX_BYTES) {
			return fail(413, { section: 'avatar', error: 'Das Bild darf hoechstens 2 MB gross sein' });
		}
		try {
			await setOwnAvatar(locals.ctx, {
				data: new Uint8Array(await file.arrayBuffer()),
				contentType: file.type
			});
		} catch (e) {
			return fail(isCoreError(e) ? e.status : 400, {
				section: 'avatar',
				error: isCoreError(e) ? e.message : 'Profilbild konnte nicht gespeichert werden.'
			});
		}
		return { section: 'avatar', success: 'Profilbild wurde gespeichert.' };
	},

	removeAvatar: async ({ locals }) => {
		try {
			await removeOwnAvatar(locals.ctx);
		} catch (e) {
			return fail(400, {
				section: 'avatar',
				error: isCoreError(e) ? e.message : 'Profilbild konnte nicht entfernt werden.'
			});
		}
		return { section: 'avatar', success: 'Profilbild wurde entfernt.' };
	}
};
