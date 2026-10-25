/**
 * Core-Dienst `core.notifications`: Kanalwahl je Person (Aus · E-Mail · Beides · Push), Standard des Typs,
 * Rückfall auf E-Mail ohne Gerät, `mandatory`/`pushOnly`, `scoped`-Typen über `forUser`, Bündelung je Aufruf,
 * Tageszusammenfassung, Push-Geräte (Allowlist, 404/410 entfernt, fremdes Gerät 404), REST nur per Session,
 * Übernahme alter Einstellungen, Konto-Löschung, Audit ohne Endpoints.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getAuth } from '$lib/server/core/auth';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser, deleteUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { registerModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { getDb, schema } from '$lib/server/core/database/client';
import { listAudit } from '$lib/server/core/audit/service';
import { setMailTransportForTests, type MailTransport } from '$lib/server/core/mail';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { setSettings } from '$lib/server/core/settings/service';
import {
	addDevice,
	isAllowedPushEndpoint,
	setPushTransportForTests,
	rotateVapidKeys
} from '$lib/server/core/notifications/push';
import {
	getMyPreferences,
	migratePreferences,
	runNotificationDigest,
	sendNotifications,
	setMyPreference
} from '$lib/server/core/notifications/service';
import type { ModuleDefinition } from '$lib/server/core/modules/types';
import type { RequestContext } from '$lib/sdk/types';

const ORIGIN = 'http://localhost:5173';
const PW = 'notify-password-1234';
const MOD = 'notitest';
let close: () => Promise<void>;
let admin: RequestContext;
const ids: Record<string, string> = {};
const ctxs: Record<string, RequestContext> = {};

type Sent = Parameters<MailTransport['sendMail']>[0];
let mails: Sent[] = [];
let pushes: { endpoint: string; payload: Record<string, string> }[] = [];
let pushStatus: (endpoint: string) => number = () => 201;

const testModule: ModuleDefinition = {
	manifest: {
		id: MOD,
		name: 'Testmodul',
		version: '1.0.0',
		dependencies: [],
		permissions: [`${MOD}.thing.view`],
		permissionDescriptions: { [`${MOD}.thing.view`]: 'Test' },
		navigation: []
	},
	notifications: {
		types: [
			{ key: 'news', label: 'Neuigkeiten', digest: true },
			{ key: 'alert', label: 'Sicherheitshinweis', mandatory: true },
			{ key: 'paid', label: 'Zahlung', pushOnly: true, defaultChannel: 'off' },
			{ key: 'secret', label: 'Nur mit Recht', permission: `${MOD}.thing.view` },
			{ key: 'box', label: 'Postfach', scoped: true }
		],
		forUser: async (ctx) =>
			ctx.userId ? [{ key: 'box', scope: `box-${ctx.userId}`, label: 'Mein Postfach' }] : []
	}
};

const device = (n: string) => ({
	endpoint: `https://fcm.googleapis.com/fcm/send/${n}`,
	keys: {
		p256dh:
			'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
		auth: 'tBHItJI5svbpez7KI4CCXg'
	},
	label: `Gerät ${n}`
});

async function signIn(email: string): Promise<string> {
	const res = await getAuth().api.signInEmail({
		body: { email, password: PW },
		returnHeaders: true
	});
	return res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
}

async function call(
	auth: { cookie?: string; key?: string },
	method: string,
	path: string,
	json?: unknown
) {
	resetAllForTests();
	const headers = new Headers();
	if (auth.key) headers.set('authorization', `Bearer ${auth.key}`);
	if (auth.cookie) {
		headers.set('cookie', auth.cookie);
		headers.set('origin', ORIGIN);
	}
	if (json !== undefined) headers.set('content-type', 'application/json');
	const url = new URL(`${ORIGIN}/api/v1${path}`);
	const res = await handleApiRequest({
		request: new Request(url, {
			method,
			headers,
			body: json === undefined ? undefined : JSON.stringify(json)
		}),
		url,
		ip: '127.0.0.1'
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return { status: res.status, body: (await res.json()) as any };
}

async function user(name: string, email: string, roleIds: string[] = []) {
	const id = await createUser(admin, { name, email, password: PW, roleIds });
	ctxs[name] = (await contextForUser(id))!.ctx;
	ids[name] = id;
	return id;
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(testModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = (await contextForUser(u!.id))!.ctx;
	await enableModule(admin, MOD);
	admin = (await contextForUser(u!.id))!.ctx;
	const viewer = await createRole(admin, {
		name: 'Betrachter',
		permissions: [`${MOD}.thing.view`, 'core.api.manage']
	});
	await user('Anna', 'anna@example.test', [viewer]);
	await user('Ben', 'ben@example.test');
	await user('Cleo', 'cleo@example.test');
	setMailTransportForTests({ sendMail: async (m) => void mails.push(m) });
	setPushTransportForTests(async (sub, payload) => {
		pushes.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
		return { statusCode: pushStatus(sub.endpoint) };
	});
});

afterAll(async () => {
	setMailTransportForTests(undefined);
	setPushTransportForTests(null);
	await close();
});

beforeEach(() => {
	mails = [];
	pushes = [];
	pushStatus = () => 201;
});

describe('Endpoint-Allowlist (SSRF-Schutz)', () => {
	it('erlaubt nur https-Endpunkte bekannter Push-Dienste', () => {
		expect(isAllowedPushEndpoint('https://fcm.googleapis.com/fcm/send/x')).toBe(true);
		expect(isAllowedPushEndpoint('https://web.push.apple.com/abc')).toBe(true);
		expect(isAllowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(
			true
		);
		expect(isAllowedPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
		expect(isAllowedPushEndpoint('http://fcm.googleapis.com/x')).toBe(false);
		expect(isAllowedPushEndpoint('https://fcm.googleapis.com:8443/x')).toBe(false);
		expect(isAllowedPushEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
		expect(isAllowedPushEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
		expect(isAllowedPushEndpoint('https://127.0.0.1/x')).toBe(false);
	});

	it('lehnt fremde Endpunkte beim Registrieren mit 422 ab', async () => {
		await expect(
			addDevice(ctxs.Anna!, { ...device('x'), endpoint: 'https://intern.example/hook' })
		).rejects.toMatchObject({ status: 422 });
	});
});

describe('Versand nach Kanalwahl', () => {
	it('Standard E-Mail; mehrere Einträge eines Aufrufs = eine Mail je Person', async () => {
		const r = await sendNotifications(admin, MOD, [
			{
				type: 'news',
				userIds: [ids.Ben!, ids.Cleo!],
				title: 'Erste',
				body: 'Text 1',
				link: '/dashboard'
			},
			{ type: 'news', userIds: [ids.Ben!], title: 'Zweite', body: 'Text 2' }
		]);
		expect(r).toMatchObject({ email: 2, push: 0, queued: 0 });
		const ben = mails.filter((m) => m.to === 'ben@example.test');
		expect(ben).toHaveLength(1);
		expect(ben[0]!.subject).toBe('2 neue Benachrichtigungen');
		expect(ben[0]!.text).toContain('Erste');
		expect(ben[0]!.text).toContain('/profile?tab=notifications');
		expect(ben[0]!.headers).toMatchObject({ 'Auto-Submitted': 'auto-generated' });
		expect(mails.find((m) => m.to === 'cleo@example.test')!.subject).toBe('Erste');
	});

	it('Aus → nichts; Push ohne Gerät → Rückfall auf E-Mail; Push mit Gerät → nur Push', async () => {
		await setMyPreference(ctxs.Ben!, { type: `${MOD}.news`, scope: '', channel: 'off' });
		await setMyPreference(ctxs.Cleo!, { type: `${MOD}.news`, scope: '', channel: 'push' });
		let r = await sendNotifications(admin, MOD, [
			{ type: 'news', userIds: [ids.Ben!, ids.Cleo!], title: 'Hallo' }
		]);
		expect(r).toMatchObject({ email: 1, push: 0, skipped: 1 });
		expect(mails.map((m) => m.to)).toEqual(['cleo@example.test']);

		mails = [];
		await addDevice(ctxs.Cleo!, device('cleo-1'));
		r = await sendNotifications(admin, MOD, [
			{
				type: 'news',
				userIds: [ids.Cleo!],
				title: 'Hallo Push',
				body: 'x'.repeat(500),
				link: '/modules/x'
			}
		]);
		expect(r).toMatchObject({ email: 0, push: 1 });
		expect(mails).toHaveLength(0);
		expect(pushes).toHaveLength(1);
		expect(pushes[0]!.payload.title).toBe('Hallo Push');
		expect(pushes[0]!.payload.url).toBe('/modules/x');
		expect(pushes[0]!.payload.body!.length).toBeLessThanOrEqual(240);
	});

	it('Beides → Mail und Push; Push-Fehler → Mail trotzdem; 410 entfernt das Gerät', async () => {
		await setMyPreference(ctxs.Cleo!, { type: `${MOD}.news`, scope: '', channel: 'both' });
		await sendNotifications(admin, MOD, [{ type: 'news', userIds: [ids.Cleo!], title: 'Beides' }]);
		expect(mails).toHaveLength(1);
		expect(pushes).toHaveLength(1);

		mails = [];
		await setMyPreference(ctxs.Cleo!, { type: `${MOD}.news`, scope: '', channel: 'push' });
		pushStatus = () => 410;
		const r = await sendNotifications(admin, MOD, [
			{ type: 'news', userIds: [ids.Cleo!], title: 'Abgelaufen' }
		]);
		expect(r.push).toBe(0);
		expect(mails.map((m) => m.subject)).toEqual(['Abgelaufen']);
		const left = await getDb()
			.select()
			.from(schema.pushSubscription)
			.where(eq(schema.pushSubscription.userId, ids.Cleo!));
		expect(left).toHaveLength(0);
	});

	it('mandatory: Aus nicht wählbar (422); pushOnly: kein Rückfall auf E-Mail', async () => {
		await expect(
			setMyPreference(ctxs.Ben!, { type: `${MOD}.alert`, scope: '', channel: 'off' })
		).rejects.toMatchObject({ status: 422 });
		await expect(
			setMyPreference(ctxs.Ben!, { type: `${MOD}.paid`, scope: '', channel: 'email' })
		).rejects.toMatchObject({ status: 422 });
		// Standard „Aus“ → nichts
		let r = await sendNotifications(admin, MOD, [
			{ type: 'paid', userIds: [ids.Ben!], title: 'Bezahlt' }
		]);
		expect(r).toMatchObject({ email: 0, push: 0, skipped: 1 });
		// Push gewählt, aber kein Gerät → weiterhin keine Mail
		await setMyPreference(ctxs.Ben!, { type: `${MOD}.paid`, scope: '', channel: 'push' });
		r = await sendNotifications(admin, MOD, [
			{ type: 'paid', userIds: [ids.Ben!], title: 'Bezahlt' }
		]);
		expect(r.email).toBe(0);
		expect(mails).toHaveLength(0);
	});

	it('ungültige Einträge (unbekannter Typ, fremder Link, scoped ohne Scope) werden übersprungen', async () => {
		const r = await sendNotifications(admin, MOD, [
			{ type: 'unknown', userIds: [ids.Ben!], title: 'X' },
			{ type: 'alert', userIds: [ids.Ben!], title: 'X', link: 'https://evil.example' },
			{ type: 'box', userIds: [ids.Ben!], title: 'X' },
			{ type: 'alert', userIds: ['gibt-es-nicht'], title: 'X' }
		]);
		expect(r).toMatchObject({ email: 0, skipped: 4 });
	});
});

describe('Profil-Einstellungen', () => {
	it('zeigt Typen nach Recht und scoped-Einträge aus forUser', async () => {
		const anna = await getMyPreferences(ctxs.Anna!);
		const keysOf = (p: typeof anna) =>
			p.groups.flatMap((g) => g.items.map((i) => `${i.type}|${i.scope}`));
		expect(keysOf(anna)).toContain(`${MOD}.secret|`);
		expect(keysOf(anna)).toContain(`${MOD}.box|box-${ids.Anna}`);
		const ben = await getMyPreferences(ctxs.Ben!);
		expect(keysOf(ben)).not.toContain(`${MOD}.secret|`);
		expect(ben.pushAvailable).toBe(true);
		// fremder Scope bzw. Typ ohne Recht → 404
		await expect(
			setMyPreference(ctxs.Ben!, { type: `${MOD}.box`, scope: `box-${ids.Anna}`, channel: 'off' })
		).rejects.toMatchObject({ status: 404 });
		await expect(
			setMyPreference(ctxs.Ben!, { type: `${MOD}.secret`, scope: '', channel: 'off' })
		).rejects.toMatchObject({ status: 404 });
	});

	it('Standardwahl löscht die Zeile; Audit ohne Endpoints', async () => {
		await setMyPreference(ctxs.Anna!, { type: `${MOD}.secret`, scope: '', channel: 'push' });
		await setMyPreference(ctxs.Anna!, { type: `${MOD}.secret`, scope: '', channel: 'email' });
		const rows = await getDb()
			.select()
			.from(schema.notificationPref)
			.where(eq(schema.notificationPref.userId, ids.Anna!));
		expect(rows.filter((r) => r.typeKey === `${MOD}.secret`)).toHaveLength(0);
		await addDevice(ctxs.Anna!, device('anna-1'));
		const audit = await listAudit({ action: 'core.notifications.device-added' });
		expect(audit.rows.length).toBeGreaterThan(0);
		expect(JSON.stringify(audit.rows)).not.toContain('fcm.googleapis.com');
	});
});

describe('Tageszusammenfassung', () => {
	it('sammelt „täglich“ und verschickt eine Mail je Person', async () => {
		await setMyPreference(ctxs.Ben!, {
			type: `${MOD}.news`,
			scope: '',
			channel: 'email',
			delivery: 'daily'
		});
		const r = await sendNotifications(admin, MOD, [
			{ type: 'news', userIds: [ids.Ben!], title: 'A' },
			{ type: 'news', userIds: [ids.Ben!], title: 'B' }
		]);
		expect(r.queued).toBe(2);
		expect(mails).toHaveLength(0);
		const d = await runNotificationDigest();
		expect(d).toMatchObject({ users: 1, email: 1 });
		expect(mails[0]!.subject).toBe('Tageszusammenfassung: 2 Benachrichtigungen');
		expect(await getDb().select().from(schema.notificationQueue)).toHaveLength(0);
		// „täglich“ ohne digest-Typ wird ignoriert
		await setMyPreference(ctxs.Ben!, {
			type: `${MOD}.alert`,
			scope: '',
			channel: 'email',
			delivery: 'daily'
		});
		mails = [];
		const r2 = await sendNotifications(admin, MOD, [
			{ type: 'alert', userIds: [ids.Ben!], title: 'Sofort' }
		]);
		expect(r2).toMatchObject({ email: 1, queued: 0 });
	});
});

describe('REST', () => {
	it('nur per Session; API-Key → 403; fremdes Gerät → 404', async () => {
		const cookie = await signIn('anna@example.test');
		const res = await call({ cookie }, 'GET', '/notifications/preferences');
		expect(res.status).toBe(200);
		expect(res.body.data.devices).toHaveLength(1);
		const key = (await createApiKey(ctxs.Anna!, { name: 'k', scopes: [`${MOD}.thing.view`] })).key;
		expect((await call({ key }, 'GET', '/notifications/preferences')).status).toBe(403);

		const put = await call({ cookie }, 'PUT', '/notifications/preferences', {
			type: `${MOD}.news`,
			channel: 'both'
		});
		expect(put.status).toBe(200);
		expect(put.body.data).toEqual({ channel: 'both', delivery: 'immediate' });

		const keyRes = await call({ cookie }, 'GET', '/notifications/push/key');
		expect(keyRes.body.data.publicKey).toMatch(/^[A-Za-z0-9_-]{80,100}$/);

		const created = await call(
			{ cookie },
			'POST',
			'/notifications/push/subscriptions',
			device('anna-2')
		);
		expect(created.status).toBe(201);
		const benCookie = await signIn('ben@example.test');
		expect(
			(
				await call(
					{ cookie: benCookie },
					'DELETE',
					`/notifications/push/subscriptions/${created.body.data.id}`
				)
			).status
		).toBe(404);
		expect(
			(
				await call(
					{ cookie },
					'DELETE',
					`/notifications/push/subscriptions/${created.body.data.id}`
				)
			).status
		).toBe(200);

		const test = await call({ cookie }, 'POST', '/notifications/push/test');
		expect(test.status).toBe(201);
		expect(test.body.data.delivered).toBe(true);
	});

	it('Push systemweit aus → Schlüssel 503, Versand per E-Mail', async () => {
		await setSettings(admin, { 'core.push.enabled': false });
		const cookie = await signIn('anna@example.test');
		expect((await call({ cookie }, 'GET', '/notifications/push/key')).status).toBe(503);
		await setMyPreference(ctxs.Anna!, { type: `${MOD}.news`, scope: '', channel: 'push' });
		const r = await sendNotifications(admin, MOD, [
			{ type: 'news', userIds: [ids.Anna!], title: 'Aus' }
		]);
		expect(r).toMatchObject({ email: 1, push: 0 });
		await setSettings(admin, { 'core.push.enabled': true });
	});
});

describe('Übernahme, Schlüsselwechsel, Konto-Löschung', () => {
	it('migratePreferences ist idempotent und überschreibt keine eigene Wahl', async () => {
		await setMyPreference(ctxs.Cleo!, { type: `${MOD}.news`, scope: '', channel: 'both' });
		const rows = [
			{ userId: ids.Cleo!, type: 'news', channel: 'off' as const },
			{ userId: ids.Cleo!, type: 'box', scope: 'box-x', channel: 'off' as const },
			{ userId: ids.Cleo!, type: 'alert', channel: 'off' as const },
			{ userId: 'unbekannt', type: 'news', channel: 'off' as const }
		];
		expect(await migratePreferences(MOD, rows)).toBe(1);
		expect(await migratePreferences(MOD, rows)).toBe(0);
		const prefs = await getDb()
			.select()
			.from(schema.notificationPref)
			.where(eq(schema.notificationPref.userId, ids.Cleo!));
		expect(prefs.find((p) => p.typeKey === `${MOD}.news`)!.channel).toBe('both');
		expect(prefs.find((p) => p.scope === 'box-x')!.channel).toBe('off');
	});

	it('neue VAPID-Schlüssel entfernen alle Geräte', async () => {
		await addDevice(ctxs.Ben!, device('ben-1'));
		const r = await rotateVapidKeys(admin);
		expect(r.removedDevices).toBeGreaterThan(0);
		expect(await getDb().select().from(schema.pushSubscription)).toHaveLength(0);
	});

	it('Konto löschen entfernt Einstellungen, Geräte und Warteschlange', async () => {
		await addDevice(ctxs.Ben!, device('ben-2'));
		await sendNotifications(admin, MOD, [{ type: 'news', userIds: [ids.Ben!], title: 'Später' }]);
		await deleteUser(admin, ids.Ben!);
		for (const t of [schema.notificationPref, schema.pushSubscription, schema.notificationQueue]) {
			expect(await getDb().select().from(t).where(eq(t.userId, ids.Ben!))).toHaveLength(0);
		}
	});
});
