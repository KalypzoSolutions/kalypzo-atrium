import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, like, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole } from '$lib/server/core/permissions/roles';
import { registerModule } from '$lib/server/core/modules/registry';
import { disableModule, enableModule, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey } from '$lib/server/core/api/keys';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { setMailTransportForTests, type MailTransport } from '$lib/server/core/mail';
import { core } from '$lib/server/core';
import { runJobNow } from '$lib/server/core/jobs';
import { defineModule } from '$lib/sdk/server';
import officesModule from '$lib/modules/offices/module';
import { resetTemplateCacheForTests } from '$lib/modules/offices/templates.service';
import type { OfficeNotification, OfficesService } from '$lib/modules/offices/contract';
import type { MyNotifications, Office } from '$lib/modules/offices/schemas';
import type { RequestContext } from '$lib/sdk/types';

// Ämter aus Modul-Vorlagen und Benachrichtigungen an Inhaber*innen (sofort / täglich / aus).

const BASE = 'http://localhost:5173/api/v1/modules/offices';
const ctxOf = async (id: string) => (await contextForUser(id))!.ctx;

/** Test-Modul, das das Amt „Kasse“ als Vorlage mitbringt */
const notifyTestModule = defineModule({
	manifest: {
		id: 'notifytest',
		name: 'Benachrichtigungstest',
		description: 'Nur für Tests',
		version: '1.0.0',
		dependencies: [],
		optionalDependencies: ['offices'],
		permissions: ['notifytest.item.view'],
		permissionDescriptions: { 'notifytest.item.view': 'Testrecht' },
		navigation: [],
		offices: [
			{
				key: 'kasse',
				name: 'Kasse',
				description: 'Verwaltet das Geld',
				notifications: [
					{ key: 'payable-created', label: 'Neue Überweisung steht an' },
					{ key: 'accounting-closed', label: 'Abrechnung abgeschlossen', description: 'Auch ZA' }
				]
			}
		]
	}
});

type SentMail = Parameters<MailTransport['sendMail']>[0];
const mails: SentMail[] = [];
let failMail = false;

let close: () => Promise<void>;
let admin: RequestContext;
let adminKey: string;
let utaKey: string;
let carlKey: string;
let utaId: string;
let benId: string;
let carlId: string;
let kasse: Office;

interface ApiResult<T = unknown> {
	status: number;
	data: T;
	error: { code: string; message: string; details?: unknown } | undefined;
}

async function api<T = unknown>(
	key: string,
	method: string,
	path: string,
	body?: unknown
): Promise<ApiResult<T>> {
	resetAllForTests();
	const url = new URL(`${BASE}${path}`);
	const headers: Record<string, string> = { authorization: `Bearer ${key}` };
	if (body !== undefined) headers['content-type'] = 'application/json';
	const res = await handleApiRequest({
		request: new Request(url, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined
		}),
		url,
		ip: '127.0.0.1'
	});
	const text = await res.text();
	const json = text ? (JSON.parse(text) as { data?: T; error?: ApiResult['error'] }) : {};
	return { status: res.status, data: json.data as T, error: json.error };
}

async function listOffices(): Promise<Office[]> {
	resetTemplateCacheForTests();
	const r = await api<Office[]>(adminKey, 'GET', '/offices');
	expect(r.status, JSON.stringify(r.error)).toBe(200);
	return r.data;
}

async function service(): Promise<OfficesService> {
	const s = await core.modules.useOptional<OfficesService>('offices', 'notifytest');
	expect(s).not.toBeNull();
	return s!;
}

const event = (e: string, subject: string, extra: Partial<OfficeNotification> = {}) => ({
	module: 'notifytest',
	office: 'kasse',
	event: e,
	subject,
	text: `Text zu ${subject}`,
	link: '/modules/treasury?tab=payables',
	...extra
});

const recipients = () => mails.map((m) => m.to).sort();

async function setPref(key: string, eventKey: string, mode: string) {
	return api<MyNotifications>(key, 'PUT', '/me/notifications', {
		module: 'notifytest',
		office: 'kasse',
		event: eventKey,
		mode
	});
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(officesModule);
	registerModule(notifyTestModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(u!.id);
	await enableModule(admin, 'offices');
	admin = await ctxOf(u!.id);
	adminKey = (await createApiKey(admin, { name: 'admin', scopes: [...admin.permissions] })).key;

	const base = await createRole(admin, {
		name: 'Basis',
		permissions: ['core.api.manage', 'offices.office.view']
	});
	const mk = (name: string, email: string) =>
		createUser(admin, { name, email, password: 'correct-horse-battery-2', roleIds: [base] });
	utaId = await mk('Uta Kasse', 'uta@example.test');
	benId = await mk('Ben Kasse', 'ben@example.test');
	carlId = await mk('Carl Ohne', 'carl@example.test');
	const scopes = ['core.api.manage', 'offices.office.view'];
	utaKey = (await createApiKey(await ctxOf(utaId), { name: 'u', scopes })).key;
	carlKey = (await createApiKey(await ctxOf(carlId), { name: 'c', scopes })).key;

	setMailTransportForTests({
		sendMail: async (m) => {
			if (failMail) throw new Error('SMTP kaputt');
			mails.push(m);
		}
	});
});

afterAll(async () => {
	setMailTransportForTests(undefined);
	await close();
});

beforeEach(() => {
	mails.length = 0;
	failMail = false;
});

describe('Vorlagen', () => {
	it('legt kein Amt an, solange das Vorlagen-Modul inaktiv ist', async () => {
		const offices = await listOffices();
		expect(offices.filter((o) => o.source)).toHaveLength(0);
	});

	it('legt das Vorlagen-Amt einmal an (mit Herkunft und Ereignissen)', async () => {
		await enableModule(admin, 'notifytest');
		const first = await listOffices();
		const fromTemplate = first.filter((o) => o.source);
		expect(fromTemplate).toHaveLength(1);
		kasse = fromTemplate[0]!;
		expect(kasse.name).toBe('Kasse');
		expect(kasse.description).toBe('Verwaltet das Geld');
		expect(kasse.source).toEqual({
			module: 'notifytest',
			moduleName: 'Benachrichtigungstest',
			key: 'kasse'
		});
		expect(kasse.notifications.map((n) => n.key)).toEqual(['payable-created', 'accounting-closed']);
		expect(kasse.notifications[1]!.description).toBe('Auch ZA');

		const again = await listOffices();
		expect(again.filter((o) => o.source)).toHaveLength(1);
		await runJobNow(admin, 'offices.sync-grants');
		expect((await listOffices()).filter((o) => o.source)).toHaveLength(1);

		const holders = await api<Office>(adminKey, 'PUT', `/offices/${kasse.id}/holders`, {
			holders: [{ userId: utaId }, { userId: benId }]
		});
		expect(holders.status, JSON.stringify(holders.error)).toBe(200);
	});

	it('zeigt keine Ereignisse, wenn das Vorlagen-Modul inaktiv ist', async () => {
		await disableModule(admin, 'notifytest');
		try {
			const office = (await listOffices()).find((o) => o.id === kasse.id)!;
			expect(office.source?.module).toBe('notifytest');
			expect(office.notifications).toEqual([]);
			const mine = await api<MyNotifications>(utaKey, 'GET', '/me/notifications');
			expect(mine.data.offices).toEqual([]);
		} finally {
			await enableModule(admin, 'notifytest');
		}
	});
});

describe('Sofort-Benachrichtigung', () => {
	it('schickt allen Inhaber*innen eine Mail an die Konto-Adresse', async () => {
		const r = await (
			await service()
		).notify(admin, [event('payable-created', 'Überweisung an Bob')]);
		expect(r).toEqual({ sent: 2, queued: 0, skipped: 0 });
		expect(recipients()).toEqual(['ben@example.test', 'uta@example.test']);
		const m = mails[0]!;
		expect(m.subject).toBe('Überweisung an Bob');
		expect(m.text).toContain('Text zu Überweisung an Bob');
		expect(m.text).toContain(`${core.app.origin()}/modules/treasury?tab=payables`);
		expect(recipients()).not.toContain('carl@example.test');
	});

	it('bündelt mehrere Ereignisse eines Aufrufs zu einer Mail je Person', async () => {
		const r = await (
			await service()
		).notify(admin, [
			event('payable-created', 'Überweisung 1'),
			event('accounting-closed', 'Abrechnung Sommerlager')
		]);
		expect(r.sent).toBe(2);
		expect(mails).toHaveLength(2);
		expect(mails[0]!.subject).toBe('2 neue Hinweise für das Amt Kasse');
		expect(mails[0]!.text).toContain('Überweisung 1');
		expect(mails[0]!.text).toContain('Abrechnung Sommerlager');
	});

	it('kürzt Betreff (eine Zeile, ≤ 150) und verwirft fremde Links', async () => {
		await (
			await service()
		).notify(admin, [
			event('payable-created', `Zeile 1\nZeile 2 ${'x'.repeat(300)}`, {
				link: 'https://evil.example/x'
			})
		]);
		const m = mails[0]!;
		expect(m.subject.includes('\n')).toBe(false);
		expect(m.subject.length).toBeLessThanOrEqual(150);
		expect(m.text).not.toContain('evil.example');
	});

	it('ignoriert unbekannte Ereignisse und Vorlagen ohne zu werfen', async () => {
		const r = await (
			await service()
		).notify(admin, [
			event('gibt-es-nicht', 'X'),
			event('payable-created', 'Y', { office: 'fremd' }),
			event('payable-created', 'Z', { module: 'unbekannt' })
		]);
		expect(r).toEqual({ sent: 0, queued: 0, skipped: 3 });
		expect(mails).toHaveLength(0);
	});

	it('zählt Versandfehler als übersprungen', async () => {
		failMail = true;
		const r = await (await service()).notify(admin, [event('payable-created', 'Fehlschlag')]);
		expect(r).toEqual({ sent: 0, queued: 0, skipped: 2 });
	});
});

describe('Einstellungen je Person', () => {
	it('GET /me/notifications liefert eigene Vorlagen-Ämter mit Standard „sofort“', async () => {
		const r = await api<MyNotifications>(utaKey, 'GET', '/me/notifications');
		expect(r.status, JSON.stringify(r.error)).toBe(200);
		expect(r.data.email).toBe('uta@example.test');
		expect(r.data.offices).toHaveLength(1);
		const o = r.data.offices[0]!;
		expect(o).toMatchObject({
			officeId: kasse.id,
			officeName: 'Kasse',
			module: 'notifytest',
			moduleName: 'Benachrichtigungstest',
			officeKey: 'kasse'
		});
		expect(o.events.map((e) => e.mode)).toEqual(['immediate', 'immediate']);

		const carl = await api<MyNotifications>(carlKey, 'GET', '/me/notifications');
		expect(carl.data.offices).toEqual([]);
	});

	it('PUT: fremdes Amt 403, unbekanntes Ereignis 422, ungültiger Modus 422', async () => {
		expect((await setPref(carlKey, 'payable-created', 'off')).status).toBe(403);
		const unknown = await setPref(utaKey, 'gibt-es-nicht', 'off');
		expect(unknown.status).toBe(422);
		expect((await setPref(utaKey, 'payable-created', 'weekly')).status).toBe(422);
	});

	it('täglich → Warteschlange, aus → nichts; Digest-Job bündelt je Person', async () => {
		const daily = await setPref(utaKey, 'payable-created', 'daily');
		expect(daily.status, JSON.stringify(daily.error)).toBe(200);
		expect(daily.data.offices[0]!.events[0]!.mode).toBe('daily');
		const benKey = (
			await createApiKey(await ctxOf(benId), {
				name: 'b',
				scopes: ['core.api.manage', 'offices.office.view']
			})
		).key;
		expect((await setPref(benKey, 'payable-created', 'off')).status).toBe(200);

		const s = await service();
		const r1 = await s.notify(admin, [event('payable-created', 'Überweisung A')]);
		expect(r1).toEqual({ sent: 0, queued: 1, skipped: 1 });
		const r2 = await s.notify(admin, [
			event('payable-created', 'Überweisung B'),
			event('accounting-closed', 'Abrechnung C')
		]);
		// Uta: B in die Warteschlange, C sofort; Ben: B aus, C sofort
		expect(r2).toEqual({ sent: 2, queued: 1, skipped: 1 });
		expect(mails.map((m) => m.subject)).toEqual(['Abrechnung C', 'Abrechnung C']);

		mails.length = 0;
		await runJobNow(admin, 'offices.notify-digest');
		expect(mails).toHaveLength(1);
		expect(mails[0]!.to).toBe('uta@example.test');
		expect(mails[0]!.subject).toBe('Tageszusammenfassung: 2 Hinweise');
		expect(mails[0]!.text).toContain('Überweisung A');
		expect(mails[0]!.text).toContain('Überweisung B');
		expect(mails[0]!.text).toContain('Amt „Kasse“');

		mails.length = 0;
		await runJobNow(admin, 'offices.notify-digest');
		expect(mails).toHaveLength(0);
	});

	it('Digest: Versandfehler lässt die Zeilen liegen', async () => {
		await (await service()).notify(admin, [event('payable-created', 'Später')]);
		failMail = true;
		await runJobNow(admin, 'offices.notify-digest');
		failMail = false;
		await runJobNow(admin, 'offices.notify-digest');
		expect(mails).toHaveLength(1);
		expect(mails[0]!.subject).toBe('Tageszusammenfassung: 1 Hinweis');
	});

	it('PUT immediate entfernt die Abweichung', async () => {
		const r = await setPref(utaKey, 'payable-created', 'immediate');
		expect(r.status).toBe(200);
		expect(r.data.offices[0]!.events[0]!.mode).toBe('immediate');
		const rows = await core.database
			.forModule('offices')
			.transaction((tx) =>
				tx.execute(sql`SELECT 1 FROM notification_prefs WHERE user_id = ${utaId}`)
			);
		expect((rows as unknown as { rows: unknown[] }).rows).toHaveLength(0);
	});
});

describe('Gelöschtes Vorlagen-Amt', () => {
	it('kommt nicht zurück; Benachrichtigungen erreichen niemanden', async () => {
		const del = await api(adminKey, 'DELETE', `/offices/${kasse.id}`);
		expect(del.status, JSON.stringify(del.error)).toBe(200);
		expect((await listOffices()).filter((o) => o.source)).toHaveLength(0);
		await runJobNow(admin, 'offices.sync-grants');
		expect((await listOffices()).filter((o) => o.source)).toHaveLength(0);

		const r = await (await service()).notify(admin, [event('payable-created', 'Niemand')]);
		expect(r).toEqual({ sent: 0, queued: 0, skipped: 1 });
		expect(mails).toHaveLength(0);
	});
});

describe('Audit', () => {
	it('protokolliert Vorlage, Versand und Einstellungen ohne Mailadressen', async () => {
		const rows = await getDb()
			.select({ action: schema.auditLog.action, metadata: schema.auditLog.metadata })
			.from(schema.auditLog)
			.where(like(schema.auditLog.action, 'offices.%'));
		const actions = new Set(rows.map((r) => r.action));
		expect(actions).toContain('offices.notification.sent');
		expect(actions).toContain('offices.notification.pref-updated');
		const created = rows.find(
			(r) =>
				r.action === 'offices.office.created' &&
				(r.metadata as Record<string, unknown> | null)?.template === 'notifytest.kasse'
		);
		expect(created).toBeTruthy();
		for (const r of rows) {
			const meta = JSON.stringify(r.metadata);
			expect(meta).not.toContain('@');
			expect(meta).not.toContain('Überweisung');
		}
	});
});
