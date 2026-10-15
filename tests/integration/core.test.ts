import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { getAuth } from '$lib/server/core/auth';
import { contextForUser, systemContext } from '$lib/server/core/auth/context';
import {
	bootstrapAdmin,
	createUser,
	deleteUser,
	setUserActive,
	setUserRoles
} from '$lib/server/core/auth/users';
import { createRole, updateRole } from '$lib/server/core/permissions/roles';
import { requirePermission } from '$lib/server/core/permissions/service';
import { ADMIN_ROLE_ID } from '$lib/server/core/permissions/catalog';
import { registerModule } from '$lib/server/core/modules/registry';
import {
	disableModule,
	enableModule,
	navigationFor,
	syncModules
} from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { handleApiRequest } from '$lib/server/core/api/router';
import { createApiKey, revokeApiKey } from '$lib/server/core/api/keys';
import { getPublicSettings, getSetting, setSetting } from '$lib/server/core/settings/service';
import { listAudit } from '$lib/server/core/audit/service';
import { defineEndpoint } from '$lib/server/core/api/registry';
import { reset } from '$lib/server/core/rate-limit';
import type { RequestContext } from '$lib/sdk/types';

const ADMIN_EMAIL = 'admin@example.test';
const ADMIN_PW = 'correct-horse-battery';

let admin: RequestContext;
let adminId: string;

async function ctxOf(userId: string): Promise<RequestContext> {
	const r = await contextForUser(userId);
	if (!r) throw new Error('Kontext nicht aufloesbar');
	return r.ctx;
}

function api(path: string, init: RequestInit & { token?: string } = {}) {
	const { token, ...rest } = init;
	const headers = new Headers(rest.headers);
	if (token) headers.set('authorization', `Bearer ${token}`);
	if (rest.body) headers.set('content-type', 'application/json');
	const url = new URL(`http://localhost:5173/api/v1${path}`);
	return handleApiRequest({
		request: new Request(url, { ...rest, headers }),
		url,
		ip: '127.0.0.1'
	});
}

beforeAll(async () => {
	await useTestDatabase();
	registerCoreApi();
	registerModule({
		manifest: {
			id: 'demo',
			name: 'Demo',
			version: '1.0.0',
			dependencies: [],
			permissions: ['demo.items.view', 'demo.items.edit'],
			navigation: [
				{ label: 'Demo', icon: 'box', path: '/modules/demo', permission: 'demo.items.view' }
			]
		},
		settings: [{ key: 'demo.token', label: 'Token', schema: z.string(), secret: true }],
		endpoints: [
			defineEndpoint({
				method: 'GET',
				path: '/items',
				summary: 'Items',
				permission: 'demo.items.view',
				handler: () => [{ id: 1 }]
			})
		]
	});
	registerModule({
		manifest: {
			id: 'child',
			name: 'Child',
			version: '1.0.0',
			dependencies: ['demo'],
			permissions: [],
			navigation: []
		}
	});
	await syncModules();
	adminId = await (async () => {
		await bootstrapAdmin(ADMIN_EMAIL, ADMIN_PW);
		const [u] = await getDb().select().from(schema.user).where(eq(schema.user.email, ADMIN_EMAIL));
		return u!.id;
	})();
	admin = await ctxOf(adminId);
});

describe('Authentifizierung', () => {
	it('meldet den Administrator an und protokolliert den Login', async () => {
		const res = await getAuth().api.signInEmail({
			body: { email: ADMIN_EMAIL, password: ADMIN_PW }
		});
		expect(res.token).toBeTruthy();
		const { rows } = await listAudit({ action: 'core.auth.login' });
		expect(rows.length).toBeGreaterThan(0);
	});

	it('sperrt nach zu vielen Fehlversuchen', async () => {
		await createUser(admin, {
			name: 'Lock',
			email: 'lock@example.test',
			password: 'a-long-enough-pw'
		});
		for (let i = 0; i < 5; i++) {
			await getAuth()
				.api.signInEmail({ body: { email: 'lock@example.test', password: 'wrong-wrong-wrong' } })
				.catch(() => undefined);
		}
		await expect(
			getAuth().api.signInEmail({
				body: { email: 'lock@example.test', password: 'a-long-enough-pw' }
			})
		).rejects.toThrow();
		reset('login:lock@example.test');
	});

	it('verhindert Anmeldung deaktivierter Benutzer', async () => {
		const id = await createUser(admin, {
			name: 'Off',
			email: 'off@example.test',
			password: 'a-long-enough-pw'
		});
		await setUserActive(admin, id, false);
		await expect(
			getAuth().api.signInEmail({
				body: { email: 'off@example.test', password: 'a-long-enough-pw' }
			})
		).rejects.toThrow();
	});
});

describe('Rechte und Rollen', () => {
	it('verweigert Aktionen ohne Berechtigung', async () => {
		const id = await createUser(admin, {
			name: 'Plain',
			email: 'plain@example.test',
			password: 'a-long-enough-pw'
		});
		const ctx = await ctxOf(id);
		await expect(requirePermission(ctx, 'core.users.create')).rejects.toMatchObject({
			code: 'forbidden'
		});
		await expect(
			createUser(ctx, { name: 'X', email: 'x@example.test', password: 'a-long-enough-pw' })
		).rejects.toMatchObject({
			code: 'forbidden'
		});
	});

	it('verhindert Rechteausweitung ueber Rollen', async () => {
		const limitedRole = await createRole(admin, {
			name: 'Rollenpfleger',
			permissions: [
				'core.roles.view',
				'core.roles.create',
				'core.roles.edit',
				'core.roles.assign',
				'core.users.view'
			]
		});
		const id = await createUser(admin, {
			name: 'Limited',
			email: 'limited@example.test',
			password: 'a-long-enough-pw',
			roleIds: [limitedRole]
		});
		const ctx = await ctxOf(id);
		// darf keine Rolle mit Rechten anlegen, die er selbst nicht hat
		await expect(
			createRole(ctx, { name: 'Boese', permissions: ['core.users.delete'] })
		).rejects.toMatchObject({ code: 'forbidden' });
		// darf sich selbst nicht die Administratorrolle geben
		await expect(setUserRoles(ctx, id, [ADMIN_ROLE_ID])).rejects.toMatchObject({
			code: 'forbidden'
		});
		// darf die Administratorrolle nicht bearbeiten
		await expect(updateRole(ctx, ADMIN_ROLE_ID, { description: 'x' })).rejects.toBeTruthy();
	});

	it('schuetzt den letzten Administrator', async () => {
		await expect(setUserActive(admin, adminId, false)).rejects.toMatchObject({ code: 'conflict' });
		await expect(deleteUser(admin, adminId)).rejects.toMatchObject({ code: 'conflict' });
	});
});

describe('Module', () => {
	it('deaktivierte Module sind per API nicht erreichbar', async () => {
		const { key } = await createApiKey(admin, { name: 'k', scopes: ['core.users.view'] });
		const res = await api('/modules/demo/items', { token: key });
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe('module_disabled');
	});

	it('aktivierte Module liefern Daten, Rechte werden geprueft', async () => {
		await enableModule(admin, 'demo');
		admin = await ctxOf(adminId); // Kontext neu aufloesen: Modulrechte sind jetzt wirksam
		const { key } = await createApiKey(admin, { name: 'k2', scopes: ['demo.items.view'] });
		const ok = await api('/modules/demo/items', { token: key });
		expect(ok.status).toBe(200);
		expect((await ok.json()).data).toEqual([{ id: 1 }]);

		const noScope = await createApiKey(admin, { name: 'k3', scopes: ['core.users.view'] });
		const denied = await api('/modules/demo/items', { token: noScope.key });
		expect(denied.status).toBe(403);
	});

	it('Navigation enthaelt aktive Module nach Berechtigung', async () => {
		const nav = await navigationFor(admin);
		expect(nav.map((n) => n.moduleId)).toContain('demo');
		const id = await createUser(admin, {
			name: 'Nav',
			email: 'nav@example.test',
			password: 'a-long-enough-pw'
		});
		expect(await navigationFor(await ctxOf(id))).toEqual([]);
	});

	it('beachtet Abhaengigkeiten', async () => {
		await expect(disableModule(admin, 'demo')).resolves.toBeUndefined();
		await expect(enableModule(admin, 'child')).rejects.toMatchObject({ code: 'conflict' });
		await enableModule(admin, 'demo');
		await enableModule(admin, 'child');
		await expect(disableModule(admin, 'demo')).rejects.toMatchObject({ code: 'conflict' });
		await disableModule(admin, 'child');
	});
});

describe('API und API-Keys', () => {
	it('weist anonyme Zugriffe ab und liefert einheitliche Fehler', async () => {
		const res = await api('/users');
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error.code).toBe('unauthenticated');
		expect(body.error.requestId).toBeTruthy();
	});

	it('speichert API-Keys nur gehasht und zeigt den Klartext einmalig', async () => {
		const { key, item } = await createApiKey(admin, { name: 'hash', scopes: ['core.users.view'] });
		const [row] = await getDb().select().from(schema.apiKey).where(eq(schema.apiKey.id, item.id));
		expect(row!.hash).not.toContain(key);
		expect(JSON.stringify(row)).not.toContain(key);
		const res = await api('/users', { token: key });
		expect(res.status).toBe(200);
	});

	it('Scopes werden mit Eigentuemerrechten geschnitten', async () => {
		const limitedRole = await createRole(admin, {
			name: 'Nur-Lesen',
			permissions: ['core.api.manage', 'core.api.view', 'core.users.view']
		});
		const uid = await createUser(admin, {
			name: 'Owner',
			email: 'owner@example.test',
			password: 'a-long-enough-pw',
			roleIds: [limitedRole]
		});
		const ownerCtx = await ctxOf(uid);
		// Scope, den der Besitzer nicht hat, ist nicht vergebbar
		await expect(
			createApiKey(ownerCtx, { name: 'x', scopes: ['core.users.delete'] })
		).rejects.toMatchObject({ code: 'forbidden' });
		const { key } = await createApiKey(ownerCtx, { name: 'ok', scopes: ['core.users.view'] });
		// Rolle wird entzogen -> Key verliert wirksame Rechte
		await getDb().delete(schema.userRole).where(eq(schema.userRole.userId, uid));
		const res = await api('/users', { token: key });
		expect(res.status).toBe(403);
	});

	it('widerrufene und abgelaufene Keys werden abgelehnt', async () => {
		const { key, item } = await createApiKey(admin, { name: 'rev', scopes: ['core.users.view'] });
		await revokeApiKey(admin, item.id);
		expect((await api('/users', { token: key })).status).toBe(401);

		const exp = await createApiKey(admin, {
			name: 'exp',
			scopes: ['core.users.view'],
			expiresAt: new Date(Date.now() + 60_000)
		});
		await getDb()
			.update(schema.apiKey)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.apiKey.id, exp.item.id));
		expect((await api('/users', { token: exp.key })).status).toBe(401);
	});

	it('API-Keys koennen keine API-Keys verwalten (sessionOnly)', async () => {
		const { key } = await createApiKey(admin, {
			name: 'adm',
			scopes: ['core.api.manage', 'core.api.view']
		});
		expect((await api('/api-keys', { token: key })).status).toBe(403);
	});

	it('validiert Eingaben', async () => {
		const { key } = await createApiKey(admin, { name: 'v', scopes: ['core.users.create'] });
		const res = await api('/users', {
			method: 'POST',
			token: key,
			body: JSON.stringify({ email: 'nope' })
		});
		expect(res.status).toBe(422);
	});

	it('begrenzt die Rate', async () => {
		const { key } = await createApiKey(admin, { name: 'rl', scopes: ['core.users.view'] });
		let last = 200;
		for (let i = 0; i < 130; i++) last = (await api('/users', { token: key })).status;
		expect(last).toBe(429);
	});
});

describe('Einstellungen und Audit', () => {
	it('verschluesselt Secrets und liefert sie nie an Clients', async () => {
		await setSetting(admin, 'core.smtp.password', 'geheim-123');
		const [raw] = await getDb()
			.select()
			.from(schema.setting)
			.where(eq(schema.setting.key, 'core.smtp.password'));
		expect(String(raw!.value)).toMatch(/^enc:v1:/);
		expect(await getSetting('core.smtp.password')).toBe('geheim-123');
		const pub = await getPublicSettings({ group: 'smtp' });
		const entry = pub.find((p) => p.key === 'core.smtp.password')!;
		expect(entry.value).toBeNull();
		expect(entry.isSet).toBe(true);
		expect(JSON.stringify(pub)).not.toContain('geheim-123');
		const { rows } = await listAudit({ action: 'core.settings' });
		expect(JSON.stringify(rows)).not.toContain('geheim-123');
	});

	it('validiert Einstellungswerte', async () => {
		await expect(setSetting(admin, 'core.design.accentColor', 'rot')).rejects.toMatchObject({
			code: 'validation_failed'
		});
	});

	it('schwaerzt sensible Metadaten im Audit-Log', async () => {
		const { logAudit } = await import('$lib/server/core/audit/service');
		await logAudit({
			action: 'test.audit.sanitize',
			actor: systemContext().actor,
			metadata: { password: 'x', nested: { apiKey: 'y' }, ok: 'z' }
		});
		const { rows } = await listAudit({ action: 'test.audit.sanitize' });
		const meta = rows[0]!.metadata as Record<string, unknown>;
		expect(meta.password).toBe('[redacted]');
		expect((meta.nested as Record<string, unknown>).apiKey).toBe('[redacted]');
		expect(meta.ok).toBe('z');
	});
});
