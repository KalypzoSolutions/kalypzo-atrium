/**
 * Anmeldung per QR-Code: Anfrage → Handy bestätigt → nur der anzeigende Browser (Geheimnis) löst einmalig ein.
 * Die Sitzung legt das Better-Auth-Plugin an (gleiche Hooks wie beim Passwort-Login).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { getAuth } from '$lib/server/core/auth';
import { contextForUser } from '$lib/server/core/auth/context';
import {
	consumeQrLogin,
	createQrLogin,
	decideQrLogin,
	inspectQrLogin,
	qrLoginStatus
} from '$lib/server/core/auth/qr-login';
import { bootstrapAdmin, createUser, setUserActive } from '$lib/server/core/auth/users';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import type { RequestContext } from '$lib/sdk/types';

const ORIGIN = 'http://localhost:5173';
const PW = 'correct-horse-battery';
let admin: RequestContext;
let user: RequestContext;
let userId: string;
let close: () => Promise<void>;
const meta = { ip: '203.0.113.5', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' };

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [a] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	admin = (await contextForUser(a!.id))!.ctx;
	userId = await createUser(admin, { name: 'Quinn', email: 'quinn@example.test', password: PW });
	user = (await contextForUser(userId))!.ctx;
});
afterAll(() => close());
beforeEach(() => resetAllForTests());

const auditCount = async (action: string) =>
	(await getDb().select().from(schema.auditLog).where(eq(schema.auditLog.action, action))).length;

describe('QR-Anmeldung', () => {
	it('Ablauf: anlegen → gescannt → bestätigt → einmalig einlösen', async () => {
		const req = await createQrLogin(meta);
		expect(await qrLoginStatus(req.id, req.secret)).toBe('pending');
		// Geheimnis und Token liegen nur als Hash in der Datenbank
		const [row] = await getDb()
			.select()
			.from(schema.loginQrRequest)
			.where(eq(schema.loginQrRequest.id, req.id));
		expect(JSON.stringify(row)).not.toContain(req.secret);
		expect(JSON.stringify(row)).not.toContain(req.token);

		const info = await inspectQrLogin(user, req.token);
		expect(info).toMatchObject({ status: 'scanned', ip: meta.ip, userAgent: meta.userAgent });
		expect(await qrLoginStatus(req.id, req.secret)).toBe('scanned');
		expect(await consumeQrLogin(req.id, req.secret, meta)).toBeNull();

		expect(await decideQrLogin(user, req.token, true)).toBe('approved');
		expect(await qrLoginStatus(req.id, req.secret)).toBe('approved');
		expect(await consumeQrLogin(req.id, 'falsches-geheimnis', meta)).toBeNull();
		expect(await consumeQrLogin(req.id, req.secret, meta)).toBe(userId);
		expect(await consumeQrLogin(req.id, req.secret, meta)).toBeNull();
		expect(await qrLoginStatus(req.id, req.secret)).toBe('consumed');
		expect(await auditCount('core.auth.qr_login_approved')).toBe(1);
		await expect(decideQrLogin(user, req.token, true)).rejects.toMatchObject({ status: 409 });
	});

	it('falsches Geheimnis sieht keinen Stand; unbekanntes Token → null/404', async () => {
		const req = await createQrLogin(meta);
		expect(await qrLoginStatus(req.id, 'x')).toBeNull();
		expect(await qrLoginStatus('kein-uuid', req.secret)).toBeNull();
		expect(await inspectQrLogin(user, 'A'.repeat(32))).toBeNull();
		await expect(decideQrLogin(user, 'A'.repeat(32), true)).rejects.toMatchObject({ status: 404 });
	});

	it('Ablehnen und Ablauf', async () => {
		const denied = await createQrLogin(meta);
		expect(await decideQrLogin(user, denied.token, false)).toBe('denied');
		expect(await qrLoginStatus(denied.id, denied.secret)).toBe('denied');
		expect(await consumeQrLogin(denied.id, denied.secret, meta)).toBeNull();

		const old = await createQrLogin(meta);
		await getDb()
			.update(schema.loginQrRequest)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.loginQrRequest.id, old.id));
		expect(await qrLoginStatus(old.id, old.secret)).toBe('expired');
		await expect(decideQrLogin(user, old.token, true)).rejects.toMatchObject({ status: 409 });
	});

	it('nur angemeldete Personen (kein API-Key, nicht anonym) dürfen bestätigen', async () => {
		const req = await createQrLogin(meta);
		const apiKeyCtx = { ...user, actor: { ...user.actor, type: 'api_key' as const } };
		await expect(decideQrLogin(apiKeyCtx, req.token, true)).rejects.toMatchObject({
			status: 401
		});
		const anon = { ...user, userId: null, actor: { type: 'user' as const, id: null, name: '-' } };
		await expect(inspectQrLogin(anon as RequestContext, req.token)).rejects.toMatchObject({
			status: 401
		});
	});

	it('Plugin: legt eine Sitzung mit Cookie an, HTTP-Weg ist gesperrt', async () => {
		const req = await createQrLogin(meta);
		await decideQrLogin(user, req.token, true);
		const res = await getAuth().api.qrLoginClaim({
			body: { id: req.id, secret: req.secret },
			headers: new Headers({ origin: ORIGIN }),
			returnHeaders: true
		});
		expect(res.headers.get('set-cookie')).toContain('session_token');
		const sessions = await getDb()
			.select()
			.from(schema.session)
			.where(eq(schema.session.userId, userId));
		expect(sessions.length).toBeGreaterThan(0);
		expect(await auditCount('core.auth.login')).toBeGreaterThan(0);

		const again = await createQrLogin(meta);
		await decideQrLogin(user, again.token, true);
		const http = await getAuth().handler(
			new Request(`${ORIGIN}/api/auth/qr-login/claim`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: ORIGIN },
				body: JSON.stringify({ id: again.id, secret: again.secret })
			})
		);
		expect(http.status).toBe(404);
		expect(await qrLoginStatus(again.id, again.secret)).toBe('approved');
	});

	it('deaktiviertes Konto bekommt keine Sitzung', async () => {
		const otherId = await createUser(admin, {
			name: 'Dora',
			email: 'dora@example.test',
			password: PW
		});
		const other = (await contextForUser(otherId))!.ctx;
		const req = await createQrLogin(meta);
		await decideQrLogin(other, req.token, true);
		await setUserActive(admin, otherId, false);
		await expect(
			getAuth().api.qrLoginClaim({ body: { id: req.id, secret: req.secret } })
		).rejects.toMatchObject({ statusCode: 403 });
		const sessions = await getDb()
			.select()
			.from(schema.session)
			.where(and(eq(schema.session.userId, otherId)));
		expect(sessions).toHaveLength(0);
	});

	it('Rate-Limit beim Anlegen je IP', async () => {
		for (let i = 0; i < 30; i++) await createQrLogin({ ip: '198.51.100.7', userAgent: null });
		await expect(createQrLogin({ ip: '198.51.100.7', userAgent: null })).rejects.toMatchObject({
			status: 429
		});
	});
});
