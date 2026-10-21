/**
 * #14/#42/#26: Rate-Limits in den Auth-Form-Actions (je IP und je Ziel), Sperre je (E-Mail, IP) statt
 * je E-Mail, globale Kontosperre mit Hinweismail, Client-IP nur aus `getClientAddress()` (gefälschte
 * X-Forwarded-For-/interne Header wirkungslos), Login-Audit nur mit maskierten Adressen.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { useTestDatabase } from '../helpers/db';
import { settleMails } from '../helpers/settle';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import {
	AUTH_RATE_LIMITS,
	LOGIN_GLOBAL_MAX_FAILURES,
	LOGIN_MAX_FAILURES,
	betterAuthCustomRules
} from '$lib/server/core/auth/auth-limits';
import { CLIENT_IP_HEADER } from '$lib/server/core/auth/client-ip';
import { listAudit } from '$lib/server/core/audit/service';
import { setMailTransportForTests } from '$lib/server/core/mail';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { syncModules } from '$lib/server/core/modules/service';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { getDb, schema } from '$lib/server/core/database/client';
import { eq } from 'drizzle-orm';
import { actions as loginActions } from '../../src/routes/login/+page.server';
import { actions as forgotActions } from '../../src/routes/forgot-password/+page.server';
import { actions as resetActions } from '../../src/routes/reset-password/+page.server';
import { actions as profileActions } from '../../src/routes/(internal)/profile/+page.server';

const ORIGIN = 'http://localhost:5173';
const PW = 'correct-horse-battery';
const EMAIL = 'tessa@example.test';
const mails: { to: string; subject: string }[] = [];
let close: () => Promise<void>;
let tessaId: string;

type Action = (e: unknown) => unknown;
type Outcome = { status: number; data?: Record<string, unknown>; location?: string };

function event(
	path: string,
	form: Record<string, string>,
	ip: string,
	extra: Record<string, unknown> = {}
) {
	const headers = new Headers({
		'content-type': 'application/x-www-form-urlencoded',
		origin: ORIGIN,
		...((extra.headers as Record<string, string>) ?? {})
	});
	const request = new Request(`${ORIGIN}${path}`, {
		method: 'POST',
		headers,
		body: new URLSearchParams(form)
	});
	return {
		request,
		url: new URL(request.url),
		getClientAddress: () => ip,
		locals: extra.locals ?? { user: null },
		cookies: { get: () => undefined, set: () => undefined }
	};
}

async function run(action: unknown, e: unknown): Promise<Outcome> {
	try {
		const r = await (action as Action)(e);
		if (isActionFailure(r))
			return { status: r.status, data: r.data as unknown as Record<string, unknown> };
		return { status: 200, data: r as unknown as Record<string, unknown> };
	} catch (x) {
		if (isRedirect(x)) return { status: x.status, location: x.location };
		throw x;
	}
}

const login = (email: string, password: string, ip: string, headers?: Record<string, string>) =>
	run(loginActions.login, event('/login?/login', { email, password }, ip, { headers }));
// wartet ereignisbasiert auf „fire and forget“ gesendete Mails (#75)
const flush = settleMails;

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [a] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	const admin = (await contextForUser(a!.id))!.ctx;
	tessaId = await createUser(admin, { name: 'Tessa', email: EMAIL, password: PW });
	setMailTransportForTests({
		sendMail: async (m) => {
			mails.push({ to: m.to, subject: m.subject });
		}
	});
});
afterAll(async () => {
	setMailTransportForTests(undefined);
	await close();
});
beforeEach(() => {
	resetAllForTests();
	mails.length = 0;
});

describe('gemeinsame Konstanten', () => {
	it('Better-Auth-customRules entsprechen den Werten der Form-Actions', () => {
		const rules = betterAuthCustomRules();
		expect(rules['/sign-in/email']).toEqual({ window: 60, max: 10 });
		expect(rules['/request-password-reset']).toEqual({ window: 300, max: 5 });
		expect(rules['/two-factor/verify-totp']).toEqual({ window: 60, max: 10 });
		expect(Object.keys(rules)).toContain('/change-password');
	});
});

describe('Login-Action (#14)', () => {
	it('11. Versuch je Minute von einer IP → „Zu viele Versuche“, andere IP unberührt', async () => {
		for (let i = 0; i < 10; i++) {
			const r = await login(`niemand${i}@example.test`, 'falsch-falsch-falsch', '10.0.0.1');
			expect(r.status).toBe(400);
		}
		const blocked = await login('niemand-x@example.test', 'falsch-falsch-falsch', '10.0.0.1');
		expect(blocked.status).toBe(429);
		expect(blocked.data?.error).toMatch(/Zu viele Versuche/);
		expect((await login(EMAIL, PW, '10.0.0.2')).status).toBe(303);
	});

	it('gefälschtes X-Forwarded-For bzw. interner IP-Header ändert die gezählte IP nicht (#42)', async () => {
		for (let i = 0; i < 10; i++) {
			const r = await login(`spoof${i}@example.test`, 'falsch-falsch-falsch', '10.0.1.1', {
				'x-forwarded-for': `203.0.113.${i}, 10.0.1.1`,
				[CLIENT_IP_HEADER]: `198.51.100.${i}`
			});
			expect(r.status).toBe(400);
		}
		const r = await login('spoof-x@example.test', 'falsch-falsch-falsch', '10.0.1.1', {
			'x-forwarded-for': '203.0.113.99'
		});
		expect(r.status).toBe(429);
		// Audit-IP = getClientAddress(), nicht der gefälschte Wert
		const { rows } = await listAudit({ action: 'core.auth.login_failed', limit: 200 });
		const spoofed = rows.filter((x) => x.actorName?.startsWith('s***@'));
		expect(spoofed.length).toBeGreaterThan(0);
		expect(new Set(spoofed.map((x) => x.ip))).toEqual(new Set(['10.0.1.1']));
	});

	it('Fehlversuche einer fremden IP sperren die Inhaber*in nicht (Sperre je E-Mail+IP)', async () => {
		for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
			expect((await login(EMAIL, 'falsch-falsch-falsch', '192.0.2.10')).status).toBe(400);
		}
		// Angreifer-IP ist für dieses Konto gesperrt – auch mit richtigem Passwort
		const attacker = await login(EMAIL, PW, '192.0.2.10');
		expect(attacker.status).toBe(400);
		expect(attacker.data?.error).toMatch(/Zu viele/);
		// Inhaber*in von eigener IP: Anmeldung klappt
		expect((await login(EMAIL, PW, '192.0.2.20')).status).toBe(303);
		const { rows } = await listAudit({ action: 'core.auth.login_blocked', limit: 20 });
		expect(rows[0]!.metadata).toMatchObject({ scope: 'ip' });
		expect(rows[0]!.actorName).toBe('t***@example.test');
	});

	it('globale Kontosperre erst ab deutlich mehr Fehlversuchen, mit Hinweismail', async () => {
		const perIp = LOGIN_MAX_FAILURES;
		for (let n = 0; n < LOGIN_GLOBAL_MAX_FAILURES; n++) {
			const ip = `198.18.${Math.floor(n / perIp)}.1`;
			expect((await login(EMAIL, 'falsch-falsch-falsch', ip)).status).toBe(400);
		}
		const owner = await login(EMAIL, PW, '192.0.2.99');
		expect(owner.status).toBe(400);
		expect(owner.data?.error).toMatch(/Zu viele/);
		await login(EMAIL, PW, '192.0.2.98');
		await flush();
		const notices = mails.filter((m) => m.to === EMAIL && /gesperrt/.test(m.subject));
		expect(notices).toHaveLength(1); // höchstens eine Mail je Sperrfenster
		const { rows } = await listAudit({ action: 'core.auth.login_blocked', limit: 5 });
		expect(rows[0]!.metadata).toMatchObject({ scope: 'account' });
	});
});

describe('Login-Audit ohne Klartext-Adresse (#26)', () => {
	it('login und login_failed speichern nur maskierte Adressen', async () => {
		await login(EMAIL, 'falsch-falsch-falsch', '10.9.0.1');
		await login(EMAIL, PW, '10.9.0.1');
		const failed = await listAudit({ action: 'core.auth.login_failed', limit: 200 });
		const ok = await listAudit({ action: 'core.auth.login', limit: 200 });
		const all = [...failed.rows, ...ok.rows];
		expect(all.length).toBeGreaterThan(0);
		for (const r of all) {
			expect(r.actorName ?? '').not.toContain('tessa@');
			expect(JSON.stringify(r.metadata)).not.toContain('tessa@');
		}
		expect(ok.rows.find((r) => r.actorId === tessaId)?.actorName).toBe('t***@example.test');
	});
});

describe('Passwort vergessen (#14)', () => {
	it('6. Anfrage in 5 min wird still verworfen (neutrale Antwort, keine Mail)', async () => {
		const forgot = (ip: string) =>
			run(forgotActions.default, event('/forgot-password', { email: EMAIL }, ip));
		for (let i = 0; i < 5; i++) {
			// verschiedene IPs: die Grenze je Adresse greift unabhängig vom IP-Limit
			expect((await forgot(`10.1.0.${i}`)).data).toEqual({ sent: true });
		}
		await flush();
		const before = mails.filter((m) => m.to === EMAIL).length;
		expect(before).toBe(5);
		expect((await forgot('10.1.0.99')).data).toEqual({ sent: true });
		await flush();
		expect(mails.filter((m) => m.to === EMAIL).length).toBe(before);
	});

	it('je IP begrenzt (verschiedene Adressen)', async () => {
		for (let i = 0; i < 5; i++) {
			await run(
				forgotActions.default,
				event('/forgot-password', { email: `x${i}@example.test` }, '10.2.0.1')
			);
		}
		await run(forgotActions.default, event('/forgot-password', { email: EMAIL }, '10.2.0.1'));
		await flush();
		expect(mails.filter((m) => m.to === EMAIL)).toHaveLength(0);
	});
});

describe('Passwort zurücksetzen (#14)', () => {
	it('je IP begrenzt', async () => {
		const body = {
			token: 'ungueltig',
			password: 'neues-passwort-123',
			confirm: 'neues-passwort-123'
		};
		for (let i = 0; i < AUTH_RATE_LIMITS.resetPassword.max; i++) {
			const r = await run(
				resetActions.default,
				event('/reset-password', { ...body, token: `t${i}` }, '10.3.0.1')
			);
			expect(r.status).toBe(400);
		}
		const r = await run(resetActions.default, event('/reset-password', body, '10.3.0.1'));
		expect(r.status).toBe(429);
	});
});

describe('Profil: Passwort/2FA je Konto begrenzt (#14)', () => {
	const prof = (name: string, form: Record<string, string>, ip: string) =>
		run(
			(profileActions as Record<string, unknown>)[name],
			event(`/profile?/${name}`, form, ip, { locals: { user: { id: tessaId } } })
		);

	it('changePassword: 6. Versuch je Konto → 429, auch von wechselnden IPs', async () => {
		const form = {
			currentPassword: 'falsch',
			newPassword: 'neues-passwort-123',
			confirm: 'neues-passwort-123'
		};
		for (let i = 0; i < AUTH_RATE_LIMITS.changePassword.max; i++) {
			expect((await prof('changePassword', form, `10.4.0.${i}`)).status).toBe(400);
		}
		const r = await prof('changePassword', form, '10.4.0.99');
		expect(r.status).toBe(429);
		expect(r.data).toMatchObject({ section: 'password' });
	});

	it('enable2fa/disable2fa/verify2fa: je Konto begrenzt', async () => {
		for (const [name, kind] of [
			['enable2fa', 'enableTwoFactor'],
			['disable2fa', 'disableTwoFactor'],
			['verify2fa', 'verifyTotp']
		] as const) {
			resetAllForTests();
			const max = AUTH_RATE_LIMITS[kind].max;
			for (let i = 0; i < max; i++) {
				expect(
					(await prof(name, { password: 'falsch', code: '000000' }, `10.5.${i}.1`)).status
				).toBe(400);
			}
			const r = await prof(name, { password: 'falsch', code: '000000' }, '10.5.99.1');
			expect(r.status, name).toBe(429);
		}
	});
});
