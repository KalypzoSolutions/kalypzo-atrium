/**
 * Benutzerverwaltung (Migration 0013): Passwort-Hilfe durch die Verwaltung, Sitzungen/2FA, Statistik, Filter,
 * Sammelaktionen, Einladung und „Als Person handeln“ (Impersonation) mit Kennzeichnung im Audit.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { settleMails } from '../helpers/settle';
import { contextForUser, resolveSession } from '$lib/server/core/auth/context';
import { getAuth } from '$lib/server/core/auth';
import { bootstrapAdmin, createUser, listUserIds, listUsers } from '$lib/server/core/auth/users';
import {
	createPasswordResetLink,
	generatePassword,
	sendInvitation,
	sendPasswordReset,
	setUserPassword
} from '$lib/server/core/auth/admin/password';
import {
	listUserSessions,
	resetTwoFactor,
	revokeUserSessions
} from '$lib/server/core/auth/admin/sessions';
import { explainUserPermissions, userStats } from '$lib/server/core/auth/admin/stats';
import { bulkUserAction, exportUsersCsv } from '$lib/server/core/auth/admin/bulk';
import {
	activeImpersonation,
	assertNotImpersonating,
	invalidateImpersonationCache,
	startImpersonation,
	stopImpersonation
} from '$lib/server/core/auth/admin/impersonation';
import { createApiKey } from '$lib/server/core/api/keys';
import { createRole } from '$lib/server/core/permissions/roles';
import { syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { listAudit, logAudit } from '$lib/server/core/audit/service';
import { getDb, schema } from '$lib/server/core/database/client';
import { setMailTransportForTests } from '$lib/server/core/mail';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import type { RequestContext } from '$lib/sdk/types';

const PW = 'correct-horse-battery';
let close: () => Promise<void>;
let admin: RequestContext;
let adminId: string;
let helper: RequestContext;
let helperId: string;
let userId: string;
let otherId: string;
let roleMember: string;
const mails: { to: string; subject: string; text: string }[] = [];

async function ctxOf(id: string) {
	const r = await contextForUser(id);
	return r!.ctx;
}

async function addSession(uid: string) {
	const id = crypto.randomUUID();
	const token = crypto.randomUUID();
	await getDb()
		.insert(schema.session)
		.values({
			id,
			token,
			userId: uid,
			expiresAt: new Date(Date.now() + 3600_000),
			createdAt: new Date(),
			updatedAt: new Date()
		});
	return { id, token };
}

async function sessionCount(uid: string) {
	return (
		await getDb()
			.select({ id: schema.session.id })
			.from(schema.session)
			.where(eq(schema.session.userId, uid))
	).length;
}

async function signIn(email: string, password: string) {
	return getAuth()
		.api.signInEmail({ body: { email, password } })
		.then(() => true)
		.catch(() => false);
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	setMailTransportForTests({
		sendMail: async (m) => {
			mails.push({ to: String(m.to), subject: String(m.subject), text: String(m.text ?? '') });
		}
	});
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [a] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = a!.id;
	admin = await ctxOf(adminId);
	roleMember = await createRole(admin, { name: 'Mitglied', permissions: [] });
	const helperRole = await createRole(admin, {
		name: 'Helfer',
		permissions: ['core.users.view', 'core.users.edit']
	});
	helperId = await createUser(admin, {
		name: 'Hanna Helfer',
		email: 'helper@example.test',
		password: PW,
		roleIds: [helperRole]
	});
	helper = await ctxOf(helperId);
	userId = await createUser(admin, {
		name: 'Uwe User',
		email: 'user@example.test',
		password: PW,
		roleIds: [roleMember]
	});
	otherId = await createUser(admin, {
		name: 'Olga Other',
		email: 'other@example.test',
		password: PW
	});
});

afterAll(async () => {
	setMailTransportForTests(undefined);
	await close();
});

describe('Passwort durch die Verwaltung', () => {
	it('Link funktioniert genau einmal und beendet Sitzungen', async () => {
		await addSession(userId);
		const { url } = await createPasswordResetLink(admin, userId);
		const token = new URL(url).searchParams.get('token')!;
		expect(token.length).toBeGreaterThan(20);
		await getAuth().api.resetPassword({ body: { newPassword: 'new-password-123', token } });
		expect(await sessionCount(userId)).toBe(0);
		expect(await signIn('user@example.test', 'new-password-123')).toBe(true);
		await expect(
			getAuth().api.resetPassword({ body: { newPassword: 'other-password-123', token } })
		).rejects.toThrow();
		// Audit nennt den Vorgang, aber nie den Link
		const { rows } = await listAudit({ action: 'core.user.password_reset_link_created' });
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows[0])).not.toContain(token);
	});

	it('Reset-Mail geht an die Person', async () => {
		mails.length = 0;
		await sendPasswordReset(admin, userId);
		await settleMails();
		expect(mails).toHaveLength(1);
		expect(mails[0]!.to).toBe('user@example.test');
		expect(mails[0]!.text).toContain('/reset-password?token=');
	});

	it('Passwort setzen mit Pflicht zur Änderung; generiertes Passwort einmal zurück', async () => {
		await addSession(userId);
		const res = await setUserPassword(admin, userId, { generate: true, mustChange: true });
		expect(res.password).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
		expect(await sessionCount(userId)).toBe(0);
		expect(await signIn('user@example.test', res.password!)).toBe(true);
		const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, userId));
		expect(u!.mustChangePassword).toBe(true);
		const resolved = await contextForUser(userId);
		expect(resolved!.user.mustChangePassword).toBe(true);
		const { rows } = await listAudit({ action: 'core.user.password_set', target: userId });
		expect(JSON.stringify(rows[0]!.metadata)).not.toContain(res.password!);
		// Eigenes Passwort über einen Link löscht die Pflicht
		const { url } = await createPasswordResetLink(admin, userId);
		await getAuth().api.resetPassword({
			body: { newPassword: PW, token: new URL(url).searchParams.get('token')! }
		});
		const [after] = await getDb().select().from(schema.user).where(eq(schema.user.id, userId));
		expect(after!.mustChangePassword).toBe(false);
	});

	it('zu kurzes Passwort → 422, eigenes Konto → 400', async () => {
		await expect(setUserPassword(admin, userId, { password: 'kurz' })).rejects.toMatchObject({
			status: 422
		});
		await expect(createPasswordResetLink(admin, adminId)).rejects.toMatchObject({ status: 400 });
	});

	it('Schutz vor Rechteausweitung: Helfer*in kann das Admin-Konto nicht übernehmen', async () => {
		await expect(createPasswordResetLink(helper, adminId)).rejects.toMatchObject({ status: 403 });
		await expect(setUserPassword(helper, adminId, { generate: true })).rejects.toMatchObject({
			status: 403
		});
		// Für Konten mit weniger Rechten klappt es
		await expect(createPasswordResetLink(helper, otherId)).resolves.toBeTruthy();
	});

	it('generatePassword liefert gemischte, lange Passwörter', () => {
		for (let i = 0; i < 50; i++) {
			const p = generatePassword();
			expect(p.length).toBe(19);
			expect(p).toMatch(/[A-Z]/);
			expect(p).toMatch(/[a-z]/);
			expect(p).toMatch(/[2-9]/);
		}
	});
});

describe('Einladung', () => {
	it('Konto ohne Passwort, Einladung setzt es', async () => {
		mails.length = 0;
		const id = await createUser(admin, {
			name: 'Ina Invite',
			email: 'invite@example.test',
			invite: true
		});
		await sendInvitation(admin, id);
		await settleMails();
		expect(mails[0]!.to).toBe('invite@example.test');
		const url = /https?:\/\/\S+/.exec(mails[0]!.text)![0];
		const token = new URL(url).searchParams.get('token')!;
		expect(new URL(url).searchParams.get('invite')).toBe('1');
		await getAuth().api.resetPassword({ body: { newPassword: 'invited-password-1', token } });
		expect(await signIn('invite@example.test', 'invited-password-1')).toBe(true);
	});
});

describe('Sitzungen und 2FA', () => {
	it('listet, beendet einzeln und alle', async () => {
		const a = await addSession(otherId);
		await addSession(otherId);
		const list = await listUserSessions(helper, otherId);
		expect(list.length).toBeGreaterThanOrEqual(2);
		expect(list[0]).not.toHaveProperty('token');
		expect(await revokeUserSessions(admin, otherId, a.id)).toBe(1);
		await expect(revokeUserSessions(admin, otherId, a.id)).rejects.toMatchObject({ status: 404 });
		expect(await revokeUserSessions(admin, otherId)).toBeGreaterThanOrEqual(1);
		expect(await sessionCount(otherId)).toBe(0);
	});

	it('2FA zurücksetzen', async () => {
		await getDb()
			.update(schema.user)
			.set({ twoFactorEnabled: true })
			.where(eq(schema.user.id, otherId));
		await getDb()
			.insert(schema.twoFactor)
			.values({ id: crypto.randomUUID(), secret: 'x', backupCodes: 'y', userId: otherId });
		await resetTwoFactor(admin, otherId);
		const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, otherId));
		expect(u!.twoFactorEnabled).toBe(false);
		const tf = await getDb()
			.select()
			.from(schema.twoFactor)
			.where(eq(schema.twoFactor.userId, otherId));
		expect(tf).toHaveLength(0);
	});
});

describe('Statistik, Rechte-Herkunft, Liste', () => {
	it('letzte Anmeldung und Kennzahlen', async () => {
		await logAudit({ action: 'core.auth.login', actor: { type: 'user', id: otherId, name: 'o' } });
		const s = await userStats(helper, otherId);
		expect(s.lastLoginAt).not.toBeNull();
		expect(s.logins30).toBeGreaterThanOrEqual(1);
		expect(s.activity).toHaveLength(90);
		expect(s.activity.at(-1)!.count).toBeGreaterThanOrEqual(1);
		expect(typeof s.files.bytes).toBe('number');
	});

	it('Rechte mit Herkunft', async () => {
		const perms = await explainUserPermissions(admin, helperId);
		const view = perms.find((p) => p.key === 'core.users.view');
		expect(view?.sources).toEqual([expect.objectContaining({ kind: 'role', roleName: 'Helfer' })]);
	});

	it('Filter, Sortierung, IDs', async () => {
		const never = await listUsers(admin, { status: 'never' });
		expect(never.items.some((u) => u.id === otherId)).toBe(false);
		const byRole = await listUsers(admin, { roleIds: [roleMember] });
		expect(byRole.items.map((u) => u.id)).toEqual([userId]);
		const sorted = await listUsers(admin, { sort: 'lastLogin' });
		expect(sorted.items[0]!.lastLoginAt).not.toBeNull();
		const ids = await listUserIds(admin, { search: 'example.test' });
		expect(ids.length).toBe(sorted.total);
	});

	it('Sammelaktion: Rolle zuweisen, eigenes Konto übersprungen', async () => {
		const res = await bulkUserAction(admin, [otherId, adminId], 'addRole', { roleId: roleMember });
		expect(res.ok).toBe(2);
		const res2 = await bulkUserAction(admin, [otherId, adminId], 'deactivate');
		expect(res2.ok).toBe(1);
		expect(res2.skipped.map((s) => s.id)).toEqual([adminId]);
		await bulkUserAction(admin, [otherId], 'activate');
		const helperRes = await bulkUserAction(helper, [adminId], 'revokeSessions');
		expect(helperRes.skipped).toHaveLength(1);
	});

	it('CSV mit Formelschutz', async () => {
		const id = await createUser(admin, {
			name: '=SUMME(1)',
			email: 'csv@example.test',
			password: PW
		});
		const csv = await exportUsersCsv(admin, { search: 'csv@' });
		expect(csv).toContain("'=SUMME(1)");
		await bulkUserAction(admin, [id], 'deactivate');
	});

	it('REST: Statistik und Sitzungen', async () => {
		resetAllForTests();
		const { key } = await createApiKey(admin, {
			name: 'test',
			scopes: ['core.users.view', 'core.users.edit']
		});
		const call = async (method: string, path: string) => {
			const url = new URL(`http://localhost:5173/api/v1${path}`);
			const res = await handleApiRequest({
				request: new Request(url, { method, headers: { authorization: `Bearer ${key}` } }),
				url,
				ip: '127.0.0.1'
			});
			return { status: res.status, body: await res.json() };
		};
		expect((await call('GET', `/users/${otherId}/stats`)).status).toBe(200);
		expect((await call('GET', `/users/${otherId}/sessions`)).status).toBe(200);
		expect((await call('DELETE', `/users/${otherId}/sessions`)).body.data).toEqual({ revoked: 0 });
		expect((await call('GET', '/users?status=never&sort=created')).status).toBe(200);
	});
});

describe('Als Person handeln', () => {
	it('verlangt Recht, Grund, Passwort; nie Admins', async () => {
		const s = await addSession(adminId);
		const base = { targetUserId: userId, reason: 'Fehler nachstellen', minutes: 30, password: PW };
		await expect(startImpersonation(helper, s.id, base)).rejects.toMatchObject({ status: 403 });
		await expect(startImpersonation(admin, s.id, { ...base, reason: '' })).rejects.toMatchObject({
			status: 422
		});
		await expect(
			startImpersonation(admin, s.id, { ...base, password: 'falsch-falsch-falsch' })
		).rejects.toMatchObject({ status: 422 });
		await expect(startImpersonation(admin, s.id, { ...base, minutes: 120 })).rejects.toMatchObject({
			status: 400
		});
		const admin2 = await createUser(admin, {
			name: 'Zweiter Admin',
			email: 'admin2@example.test',
			password: PW,
			roleIds: ['role_administrator']
		});
		await expect(
			startImpersonation(admin, s.id, { ...base, targetUserId: admin2 })
		).rejects.toMatchObject({ status: 403 });
		await expect(
			startImpersonation(admin, s.id, { ...base, targetUserId: adminId })
		).rejects.toMatchObject({ status: 400 });
	});

	it('Sitzung handelt als Zielperson, Audit nennt die Admin-Person, Ende greift', async () => {
		resetAllForTests();
		mails.length = 0;
		const s = await addSession(adminId);
		await startImpersonation(admin, s.id, {
			targetUserId: userId,
			reason: 'Fehler nachstellen',
			minutes: 15,
			password: PW
		});
		await settleMails();
		expect(mails.some((m) => m.to === 'user@example.test')).toBe(true);
		const headers = new Headers({
			cookie: `better-auth.session_token=${await signedToken(s.token)}`
		});
		const r = await resolveSession(headers);
		expect(r?.ctx.userId).toBe(userId);
		expect(r?.ctx.actor.impersonator?.id).toBe(adminId);
		expect(r?.impersonation?.target.name).toBe('Uwe User');
		expect(r?.ctx.permissions.has('core.users.view')).toBe(false);
		expect(() => assertNotImpersonating(r!.ctx)).toThrow();
		await expect(createApiKey(r!.ctx, { name: 'x', scopes: [] })).rejects.toMatchObject({
			status: expect.any(Number)
		});
		// Audit in ihrem Namen trägt die Admin-Person
		const { auditFromContext } = await import('$lib/server/core/audit/service');
		await auditFromContext(r!.ctx, 'core.test.done', { target: 'x' });
		const [row] = (await listAudit({ action: 'core.test.done' })).rows;
		expect(row!.actorId).toBe(userId);
		expect(row!.impersonatorId).toBe(adminId);
		const involving = await listAudit({ involving: adminId, action: 'core.test.' });
		expect(involving.total).toBe(1);

		await stopImpersonation(s.id, r!.ctx);
		const back = await resolveSession(headers);
		expect(back?.ctx.userId).toBe(adminId);
		expect(back?.impersonation).toBeNull();
		const ended = await listAudit({ action: 'core.user.impersonation_ended' });
		expect(ended.rows[0]!.metadata).toMatchObject({ reason: 'stopped' });
	});

	it('Ablauf und Sperre des Ziels beenden das Handeln', async () => {
		resetAllForTests();
		const s = await addSession(adminId);
		await startImpersonation(admin, s.id, {
			targetUserId: userId,
			reason: 'Ablauf testen',
			minutes: 15,
			password: PW
		});
		await getDb()
			.update(schema.userImpersonation)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.userImpersonation.sessionId, s.id));
		invalidateImpersonationCache(s.id);
		expect(await activeImpersonation(s.id)).toBeNull();
		const [row] = await getDb()
			.select()
			.from(schema.userImpersonation)
			.where(and(eq(schema.userImpersonation.sessionId, s.id)));
		expect(row!.endReason).toBe('expired');

		resetAllForTests();
		await startImpersonation(admin, s.id, {
			targetUserId: userId,
			reason: 'Sperre testen',
			minutes: 15,
			password: PW
		});
		await getDb().update(schema.user).set({ active: false }).where(eq(schema.user.id, userId));
		invalidateImpersonationCache(s.id);
		expect(await activeImpersonation(s.id)).toBeNull();
		await getDb().update(schema.user).set({ active: true }).where(eq(schema.user.id, userId));
	});
});

/** Better Auth signiert das Sitzungs-Cookie (HMAC-SHA-256 mit APP_SECRET). */
async function signedToken(token: string): Promise<string> {
	const ctx = await getAuth().$context;
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(ctx.secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
	return encodeURIComponent(`${token}.${Buffer.from(sig).toString('base64')}`);
}

describe('Migration 0013', () => {
	it('übernimmt die letzte Anmeldung aus dem Audit (Backfill)', async () => {
		const { readFileSync } = await import('node:fs');
		const { sql } = await import('drizzle-orm');
		const file = readFileSync('drizzle/0013_user_admin.sql', 'utf8');
		const update = file.split('--> statement-breakpoint').find((p) => p.includes('UPDATE "user"'))!;
		await getDb()
			.update(schema.user)
			.set({ lastLoginAt: null })
			.where(eq(schema.user.id, helperId));
		await logAudit({ action: 'core.auth.login', actor: { type: 'user', id: helperId, name: 'h' } });
		await getDb()
			.update(schema.user)
			.set({ lastLoginAt: null })
			.where(eq(schema.user.id, helperId));
		await getDb().execute(sql.raw(update));
		const [u] = await getDb().select().from(schema.user).where(eq(schema.user.id, helperId));
		expect(u!.lastLoginAt).toBeInstanceOf(Date);
	});
});
