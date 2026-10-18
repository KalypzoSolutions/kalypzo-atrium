/**
 * Regression: /profile darf bei einer aelteren Anmeldung nicht mit 500 abbrechen.
 * Better Auth `listSessions` verlangt eine frische Sitzung (`freshAge`, Standard 1 Tag) und wirft sonst
 * „Session is not fresh“ – die Seite liest die Sitzungen deshalb direkt aus der Datenbank.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getAuth } from '$lib/server/core/auth';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { getDb, schema } from '$lib/server/core/database/client';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import { actions, load } from '../../src/routes/(internal)/profile/+page.server';

const ORIGIN = 'http://localhost:5173';
const PW = 'correct-horse-battery';
let close: () => Promise<void>;
let userId: string;
let headers: Headers;
let sessionId: string;
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	userId = u!.id;
	const res = await getAuth().api.signInEmail({
		body: { email: 'admin@example.test', password: PW },
		returnHeaders: true
	});
	headers = new Headers({
		cookie: res.headers
			.getSetCookie()
			.map((c) => c.split(';')[0])
			.join('; '),
		origin: ORIGIN
	});
	const [s] = await getDb().select().from(schema.session).where(eq(schema.session.userId, userId));
	sessionId = s!.id;
	// Anmeldung vor drei Tagen: laenger als `freshAge`
	await getDb()
		.update(schema.session)
		.set({ createdAt: new Date(Date.now() - 3 * DAY) })
		.where(eq(schema.session.id, sessionId));
});
afterAll(async () => {
	await close();
});

async function event() {
	const { ctx, user } = (await contextForUser(userId))!;
	return {
		request: new Request(`${ORIGIN}/profile`, { headers }),
		locals: { user, ctx, sessionId }
	};
}

describe('/profile mit alter Sitzung', () => {
	it('Voraussetzung: Better Auth listSessions weist die alte Sitzung ab', async () => {
		await expect(getAuth().api.listSessions({ headers })).rejects.toThrow();
	});

	it('load liefert die Sitzungen trotzdem (kein 500)', async () => {
		const data = (await (
			load as (e: unknown) => Promise<{ sessions: Array<{ id: string; current: boolean }> }>
		)(await event()))!;
		expect(data.sessions).toHaveLength(1);
		expect(data.sessions[0]!.id).toBe(sessionId);
		expect(data.sessions[0]!.current).toBe(true);
	});

	it('abgelaufene Sitzungen erscheinen nicht', async () => {
		await getDb()
			.insert(schema.session)
			.values({
				id: 'expired-session',
				token: 'expired-token',
				userId,
				expiresAt: new Date(Date.now() - DAY),
				ipAddress: null,
				userAgent: null
			});
		const data = (await (load as (e: unknown) => Promise<{ sessions: Array<{ id: string }> }>)(
			await event()
		))!;
		expect(data.sessions.map((s) => s.id)).toEqual([sessionId]);
	});

	it('revokeSession beendet eine fremde Sitzung auch bei alter eigener Sitzung', async () => {
		const other = await getAuth().api.signInEmail({
			body: { email: 'admin@example.test', password: PW },
			returnHeaders: false
		});
		expect(other.token).toBeTruthy();
		const rows = await getDb()
			.select()
			.from(schema.session)
			.where(eq(schema.session.userId, userId));
		const target = rows.find((r) => r.id !== sessionId && r.expiresAt > new Date())!;
		const f = new FormData();
		f.set('id', target.id);
		const ev = await event();
		const res = (await (actions.revokeSession as (e: unknown) => unknown)({
			...ev,
			request: new Request(`${ORIGIN}/profile?/revokeSession`, {
				method: 'POST',
				body: f,
				headers
			})
		})) as { success?: string; error?: string };
		expect(res.error).toBeUndefined();
		expect(res.success).toBeTruthy();
		const after = await getDb()
			.select()
			.from(schema.session)
			.where(eq(schema.session.id, target.id));
		expect(after).toHaveLength(0);
	});
});
