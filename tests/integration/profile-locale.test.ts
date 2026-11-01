/**
 * Sprachwahl im Profil (Phase N): `saveSettings` speichert `core.user.locale`, setzt das Cookie `locale`
 * und die nächste Anfrage wird englisch gerendert. „Wie System“ (leer) löscht beides wieder.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { getDb, schema } from '$lib/server/core/database/client';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import { getSetting } from '$lib/server/core/settings/service';
import {
	installServerLocale,
	LOCALE_COOKIE,
	resolveLocale,
	withLocale
} from '$lib/server/core/i18n/locale';
import { t } from '$lib/i18n';
import { actions, load } from '../../src/routes/(internal)/profile/+page.server';
import { actions as loginActions } from '../../src/routes/login/+page.server';

const ORIGIN = 'http://localhost:5173';
let close: () => Promise<void>;
let userId: string;

/** Minimaler Cookie-Speicher wie SvelteKits `Cookies` */
function cookieJar() {
	const store = new Map<string, { value: string; opts: Record<string, unknown> }>();
	return {
		store,
		get: (name: string) => store.get(name)?.value,
		set: (name: string, value: string, opts: Record<string, unknown>) =>
			store.set(name, { value, opts }),
		delete: (name: string) => store.delete(name)
	};
}

async function saveLocale(value: string, cookies: ReturnType<typeof cookieJar>) {
	const { ctx, user } = (await contextForUser(userId))!;
	const body = new FormData();
	body.set('locale', value);
	const action = actions.saveSettings as unknown as (e: unknown) => Promise<unknown>;
	return action({
		request: new Request(`${ORIGIN}/profile?/saveSettings`, { method: 'POST', body }),
		locals: { user, ctx, sessionId: 'x', locale: 'de' },
		cookies,
		url: new URL(`${ORIGIN}/profile`)
	});
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	await installServerLocale();
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	userId = u!.id;
});
afterAll(async () => {
	await close();
});

describe('Sprache im Profil', () => {
	it('speichert Englisch, setzt das Cookie und die Seite rendert englisch', async () => {
		const cookies = cookieJar();
		const res = (await saveLocale('en', cookies)) as { success?: string };
		expect(res.success).toBe('Einstellungen gespeichert.');
		expect(await getSetting('core.user.locale', userId)).toBe('en');
		const c = cookies.store.get(LOCALE_COOKIE);
		expect(c?.value).toBe('en');
		expect(c?.opts).toMatchObject({ path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });

		// Nächste Anfrage: Konto-Einstellung gewinnt (Cache wurde geleert), auch gegen ein deutsches Cookie
		const locale = await resolveLocale({ userId, cookie: 'de', acceptLanguage: 'de-DE' });
		expect(locale).toBe('en');
		expect(withLocale(locale, () => t('profile.title'))).toBe('Profile');

		const { ctx, user } = (await contextForUser(userId))!;
		const data = (await withLocale(locale, () =>
			(load as unknown as (e: unknown) => Promise<Record<string, unknown>>)({
				locals: { user, ctx, sessionId: 'x', locale }
			})
		)) as { settings: { locale: string }; startPageOptions: { label: string }[] };
		expect(data.settings.locale).toBe('en');
		expect(data.startPageOptions[1]!.label).toBe('Profile');
	});

	it('„Wie System“ löscht Einstellung und Cookie', async () => {
		const cookies = cookieJar();
		cookies.set(LOCALE_COOKIE, 'en', {});
		await saveLocale('', cookies);
		expect(await getSetting('core.user.locale', userId)).toBe('');
		expect(cookies.store.has(LOCALE_COOKIE)).toBe(false);
		expect(await resolveLocale({ userId, acceptLanguage: 'de-DE' })).toBe('de');
	});

	it('Login-Seite: Sprachwahl setzt nur das Cookie und leitet zurück', async () => {
		const cookies = cookieJar();
		const body = new FormData();
		body.set('locale', 'en');
		const action = loginActions.locale as unknown as (e: unknown) => Promise<unknown>;
		const err = await action({
			request: new Request(`${ORIGIN}/login?/locale`, { method: 'POST', body }),
			cookies,
			url: new URL(`${ORIGIN}/login?/locale&redirectTo=%2Fprofile`)
		}).catch((e: unknown) => e);
		expect(err).toMatchObject({ status: 303, location: '/login?redirectTo=%2Fprofile' });
		expect(cookies.store.get(LOCALE_COOKIE)?.value).toBe('en');
		expect(await resolveLocale({ cookie: 'en', acceptLanguage: 'de-DE' })).toBe('en');
	});
});
