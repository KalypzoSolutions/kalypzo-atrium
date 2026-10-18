import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { getAuth } from '$lib/server/core/auth';
import { contextForUser } from '$lib/server/core/auth/context';
import { requestEmailChange } from '$lib/server/core/auth/profile';
import { bootstrapAdmin, createUser, updateUser } from '$lib/server/core/auth/users';
import { setMailTransportForTests } from '$lib/server/core/mail';
import { registerModule } from '$lib/server/core/modules/registry';
import { syncModules } from '$lib/server/core/modules/service';
import { listAudit } from '$lib/server/core/audit/service';
import { setSetting } from '$lib/server/core/settings/service';
import { loadUserPrefs, resolvePageSize } from '$lib/server/core/settings/user-prefs';
import { reset, resetAllForTests } from '$lib/server/core/rate-limit';
import type { RequestContext } from '$lib/sdk/types';

const ORIGIN = 'http://localhost:5173';
const PW = 'correct-horse-battery';

interface Mail {
	to: string;
	subject: string;
	text: string;
}
const mails: Mail[] = [];

let admin: RequestContext;
let close: () => Promise<void>;

async function ctxOf(userId: string): Promise<RequestContext> {
	const r = await contextForUser(userId);
	if (!r) throw new Error('Kontext nicht auflösbar');
	return r.ctx;
}

async function login(email: string, password = PW): Promise<Headers> {
	const res = await getAuth().api.signInEmail({
		body: { email, password },
		returnHeaders: true
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	return new Headers({ cookie, origin: ORIGIN });
}

async function flush(): Promise<void> {
	// Mails werden "fire and forget" gesendet
	await new Promise((r) => setTimeout(r, 50));
}

async function userByEmail(email: string) {
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.email, email));
	return u;
}

async function auditOf(target: string, action: string) {
	const { rows } = await listAudit({ target, limit: 100 });
	return rows.filter((r) => r.action === action);
}

function verifyUrl(mail: Mail): string {
	const m = /https?:\/\/\S+\/verify-email\?\S+/.exec(mail.text);
	if (!m) throw new Error('Kein Bestätigungslink in der Mail');
	return m[0];
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	setMailTransportForTests({
		sendMail: async (m) => {
			mails.push({ to: m.to, subject: m.subject, text: m.text });
		}
	});
	registerModule({
		manifest: {
			id: 'rgtest',
			name: 'Rollen-Test',
			version: '1.0.0',
			dependencies: [],
			permissions: ['rgtest.thing.view', 'rgtest.thing.edit'],
			navigation: []
		},
		defaultRoleGrants: { Testrolle: ['rgtest.thing.view', 'rgtest.thing.edit', 'rgtest.unknown.x'] }
	});
	registerModule({
		manifest: {
			id: 'rgmanifest',
			name: 'Rollen-Test 2',
			version: '1.0.0',
			dependencies: [],
			permissions: ['rgmanifest.thing.view'],
			navigation: [],
			defaultRoleGrants: { Testrolle: ['rgmanifest.thing.view'] }
		}
	});
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [a] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = await ctxOf(a!.id);
});

afterAll(async () => {
	setMailTransportForTests(undefined);
	await close();
});

describe('E-Mail-Wechsel', () => {
	let uid: string;
	let other: string;

	beforeAll(async () => {
		uid = await createUser(admin, { name: 'Uwe', email: 'uwe@example.test', password: PW });
		other = await createUser(admin, { name: 'Olga', email: 'olga@example.test', password: PW });
	});

	it('falsches Passwort: keine Mail, keine Änderung', async () => {
		const headers = await login('uwe@example.test');
		mails.length = 0;
		await expect(
			requestEmailChange(await ctxOf(uid), headers, {
				newEmail: 'neu@example.test',
				password: 'falsch-falsch-falsch'
			})
		).rejects.toMatchObject({ code: 'bad_request' });
		await flush();
		expect(mails).toHaveLength(0);
		expect((await userByEmail('uwe@example.test'))?.id).toBe(uid);
		expect(await userByEmail('neu@example.test')).toBeUndefined();
	});

	it('ungültige Adresse wird abgewiesen (422)', async () => {
		const headers = await login('uwe@example.test');
		await expect(
			requestEmailChange(await ctxOf(uid), headers, { newEmail: 'kein-mail', password: PW })
		).rejects.toMatchObject({ code: 'validation_failed' });
	});

	it('gültig: Link an die neue Adresse, Hinweis an die alte, Adresse bleibt bis zum Klick', async () => {
		const headers = await login('uwe@example.test');
		mails.length = 0;
		await requestEmailChange(await ctxOf(uid), headers, {
			newEmail: 'Neu@Example.test ',
			password: PW
		});
		await flush();
		const toNew = mails.filter((m) => m.to === 'neu@example.test');
		const toOld = mails.filter((m) => m.to === 'uwe@example.test');
		expect(toNew).toHaveLength(1);
		expect(toOld).toHaveLength(1);
		// Hinweis an die alte Adresse enthält keinen Link und nur die maskierte neue Adresse
		expect(toOld[0]!.text).not.toContain('verify-email');
		expect(toOld[0]!.text).not.toContain('neu@example.test');
		expect(toNew[0]!.text).toContain('/verify-email?token=');
		expect((await userByEmail('uwe@example.test'))?.id).toBe(uid);
		const audit = { rows: await auditOf(uid, 'core.auth.email_change_requested') };
		expect(audit.rows.length).toBeGreaterThan(0);
		const meta = JSON.stringify(audit.rows[0]!.metadata);
		expect(meta).toContain('u***@example.test');
		expect(meta).not.toContain('uwe@');

		// Ohne Session legt der Link keine Session an und ändert nichts
		const link = verifyUrl(toNew[0]!);
		const anon = await getAuth().handler(new Request(link));
		expect(anon.status).toBe(302);
		expect(new URL(anon.headers.get('location')!, ORIGIN).pathname).toBe('/login');
		expect(anon.headers.get('set-cookie')).toBeNull();
		expect((await userByEmail('uwe@example.test'))?.id).toBe(uid);

		// Mit Session (gleicher Browser): Adresse wechselt
		const ok = await getAuth().handler(new Request(link, { headers }));
		expect(ok.status).toBe(302);
		expect(ok.headers.get('location')).toContain('/profile?emailChanged=1');
		const changed = await userByEmail('neu@example.test');
		expect(changed?.id).toBe(uid);
		expect(changed?.emailVerified).toBe(true);
		expect(await userByEmail('uwe@example.test')).toBeUndefined();
		const done = { rows: await auditOf(uid, 'core.auth.email_changed') };
		expect(done.rows).toHaveLength(1);
		expect(done.rows[0]!.metadata).toEqual({
			from: 'u***@example.test',
			to: 'n***@example.test',
			otherSessionsRevoked: expect.any(Number)
		});
	});

	it('belegte Adresse: identische Antwort, aber kein Link an die belegte Adresse', async () => {
		const headers = await login('olga@example.test');
		mails.length = 0;
		await expect(
			requestEmailChange(await ctxOf(other), headers, {
				newEmail: 'neu@example.test',
				password: PW
			})
		).resolves.toBeUndefined();
		await flush();
		expect(mails.filter((m) => m.to === 'neu@example.test')).toHaveLength(0);
		expect((await userByEmail('olga@example.test'))?.id).toBe(other);
	});

	it('Rate-Limit für /change-email (5 je 5 Minuten)', async () => {
		resetAllForTests();
		const statuses: number[] = [];
		for (let i = 0; i < 6; i++) {
			const res = await getAuth().handler(
				new Request(`${ORIGIN}/api/auth/change-email`, {
					method: 'POST',
					headers: {
						'content-type': 'application/json',
						origin: ORIGIN,
						'x-forwarded-for': '203.0.113.9'
					},
					body: JSON.stringify({ newEmail: 'x@example.test' })
				})
			);
			statuses.push(res.status);
		}
		expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
		expect(statuses[5]).toBe(429);
	});

	it('Passwortprüfung ist je Benutzer begrenzt', async () => {
		reset(`pwcheck:${uid}`);
		const headers = await login('neu@example.test');
		const ctx = await ctxOf(uid);
		for (let i = 0; i < 5; i++) {
			await expect(
				requestEmailChange(ctx, headers, {
					newEmail: 'a@example.test',
					password: 'falsch-falsch-1'
				})
			).rejects.toMatchObject({ code: 'bad_request' });
		}
		// sechster Versuch ist gesperrt, auch mit richtigem Passwort
		await expect(
			requestEmailChange(ctx, headers, { newEmail: 'a@example.test', password: PW })
		).rejects.toMatchObject({ code: 'bad_request' });
		reset(`pwcheck:${uid}`);
	});
});

describe('Admin: E-Mail ändern', () => {
	it('setzt emailVerified, widerruft Sessions, Duplikat -> 409', async () => {
		const id = await createUser(admin, { name: 'Ada', email: 'ada@example.test', password: PW });
		await createUser(admin, { name: 'Bob', email: 'bob@example.test', password: PW });
		await login('ada@example.test');
		await getDb().update(schema.user).set({ emailVerified: false }).where(eq(schema.user.id, id));
		expect(
			await getDb().select().from(schema.session).where(eq(schema.session.userId, id))
		).toHaveLength(1);

		await expect(updateUser(admin, id, { email: 'BOB@example.test' })).rejects.toMatchObject({
			code: 'conflict'
		});

		await updateUser(admin, id, { email: 'ada2@example.test' });
		const u = await userByEmail('ada2@example.test');
		expect(u?.emailVerified).toBe(true);
		expect(
			await getDb().select().from(schema.session).where(eq(schema.session.userId, id))
		).toHaveLength(0);

		// nur Name: Sessions bleiben
		await login('ada2@example.test');
		await updateUser(admin, id, { name: 'Ada L.' });
		expect(
			await getDb().select().from(schema.session).where(eq(schema.session.userId, id))
		).toHaveLength(1);
	});
});

describe('Benutzer-Einstellungen', () => {
	it('Zod-Prüfung beim Speichern und loadUserPrefs', async () => {
		const id = await createUser(admin, { name: 'Pia', email: 'pia@example.test', password: PW });
		const ctx = await ctxOf(id);
		await expect(setSetting(ctx, 'core.user.accentColor', 'red')).rejects.toMatchObject({
			code: 'validation_failed'
		});
		await expect(setSetting(ctx, 'core.user.startPage', '/A?b')).rejects.toMatchObject({
			code: 'validation_failed'
		});
		await expect(setSetting(ctx, 'core.user.density', 'dense')).rejects.toMatchObject({
			code: 'validation_failed'
		});
		await expect(setSetting(ctx, 'core.user.pageSize', 5)).rejects.toMatchObject({
			code: 'validation_failed'
		});
		const before = await loadUserPrefs(id);
		expect(before).toMatchObject({
			themeExplicit: false,
			accentColor: '',
			density: 'comfortable',
			startPage: '/dashboard',
			pageSize: 25
		});
		await setSetting(ctx, 'core.user.accentColor', '#16A34A');
		await setSetting(ctx, 'core.user.density', 'compact');
		await setSetting(ctx, 'core.user.theme', 'dark');
		await setSetting(ctx, 'core.user.startPage', '/modules/members');
		const after = await loadUserPrefs(id);
		expect(after).toMatchObject({
			theme: 'dark',
			themeExplicit: true,
			density: 'compact',
			startPage: '/modules/members'
		});
		expect(after.accentColor).toBe('#16a34a');
	});

	it('resolvePageSize: eigene Einstellung, sonst Fallback', async () => {
		const a = await createUser(admin, { name: 'Ina', email: 'ina@example.test', password: PW });
		const b = await createUser(admin, { name: 'Ivo', email: 'ivo@example.test', password: PW });
		expect(await resolvePageSize({ user: { id: a } }, 50)).toBe(50);
		await setSetting(await ctxOf(a), 'core.user.pageSize', 40);
		expect(await resolvePageSize({ user: { id: a } }, 50)).toBe(40);
		expect(await resolvePageSize({ user: { id: b } }, 20)).toBe(20);
		expect(await resolvePageSize({ user: null }, 20)).toBe(20);
		// je Anfrage (locals-Objekt) nur einmal gelesen
		const locals = { user: { id: a } };
		expect(await resolvePageSize(locals, 50)).toBe(40);
		await setSetting(await ctxOf(a), 'core.user.pageSize', 60);
		expect(await resolvePageSize(locals, 50)).toBe(40);
		expect(await resolvePageSize({ user: { id: a } }, 50)).toBe(60);
	});
});

describe('defaultRoleGrants (Rollen-Nachzug)', () => {
	async function roleKeys(name: string): Promise<string[]> {
		const rows = await getDb()
			.select({ key: schema.rolePermission.permissionKey })
			.from(schema.rolePermission)
			.innerJoin(schema.role, eq(schema.role.id, schema.rolePermission.roleId))
			.where(eq(schema.role.name, name));
		return rows.map((r) => r.key).sort();
	}

	it('legt die Rolle an und vergibt bekannte Rechte (Definition und Manifest)', async () => {
		expect(await roleKeys('Testrolle')).toEqual([
			'rgmanifest.thing.view',
			'rgtest.thing.edit',
			'rgtest.thing.view'
		]);
		const [r] = await getDb().select().from(schema.role).where(eq(schema.role.name, 'Testrolle'));
		expect(r?.isSystem).toBe(false);
	});

	it('vergibt jedes Recht nur einmal: entzogene Rechte kommen nicht zurück', async () => {
		const [r] = await getDb().select().from(schema.role).where(eq(schema.role.name, 'Testrolle'));
		await getDb()
			.delete(schema.rolePermission)
			.where(
				and(
					eq(schema.rolePermission.roleId, r!.id),
					eq(schema.rolePermission.permissionKey, 'rgtest.thing.edit')
				)
			);
		await syncModules();
		await syncModules();
		expect(await roleKeys('Testrolle')).toEqual(['rgmanifest.thing.view', 'rgtest.thing.view']);
	});

	it('bestehende Rolle wird erweitert, nicht doppelt angelegt', async () => {
		const roles = await getDb().select().from(schema.role).where(eq(schema.role.name, 'Testrolle'));
		expect(roles).toHaveLength(1);
	});
});
