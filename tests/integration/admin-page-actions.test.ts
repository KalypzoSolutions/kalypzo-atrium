/**
 * #63: Server-Actions und Loads der Verwaltungsseiten (`/admin/**`) stichprobenartig – Rechte und
 * Validierung. Form-Actions laufen ohne Layout-Load, jede Action muss das Recht daher selbst (bzw. über
 * den aufgerufenen Dienst) prüfen.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin, createUser } from '$lib/server/core/auth/users';
import { createRole, listRoles } from '$lib/server/core/permissions/roles';
import { registerModule } from '$lib/server/core/modules/registry';
import { isModuleEnabled, syncModules } from '$lib/server/core/modules/service';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { getDb, schema } from '$lib/server/core/database/client';
import { defineModule } from '$lib/sdk/server';
import type { RequestContext } from '$lib/sdk/types';
import * as rolesPage from '../../src/routes/(internal)/admin/roles/+page.server';
import * as apiPage from '../../src/routes/(internal)/admin/api/+page.server';
import * as modulesPage from '../../src/routes/(internal)/admin/modules/+page.server';
import * as auditPage from '../../src/routes/(internal)/admin/audit/+page.server';

const ORIGIN = 'http://localhost:5173';
const PW = 'correct-horse-battery';
let close: () => Promise<void>;
let admin: RequestContext;
const ids: Record<string, string> = {};

const dummy = defineModule({
	manifest: {
		id: 'adminprobe',
		name: 'Probe',
		version: '1.0.0',
		dependencies: [],
		permissions: [],
		navigation: []
	}
});

async function locals(userId: string) {
	const { ctx, user } = (await contextForUser(userId))!;
	return { ctx, user, sessionId: 's' } as unknown as App.Locals;
}

type Action = (e: unknown) => Promise<unknown>;
async function act(
	actions: Record<string, unknown>,
	name: string,
	who: string,
	form: Record<string, string | string[]>
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) {
		for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
	}
	const request = new Request(`${ORIGIN}/admin/x?/${name}`, { method: 'POST', body: fd });
	return (actions[name] as Action)({
		request,
		locals: await locals(ids[who]!),
		url: new URL(request.url)
	}) as Promise<{ status?: number; data?: { message: string }; success?: boolean }>;
}

async function loadAs(load: unknown, who: string) {
	return (load as (e: unknown) => Promise<unknown>)({
		locals: await locals(ids[who]!),
		url: new URL(`${ORIGIN}/admin/x`)
	});
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(dummy);
	await syncModules();
	await bootstrapAdmin('admin@example.test', PW);
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	ids.admin = u!.id;
	admin = (await contextForUser(u!.id))!.ctx;
	const viewer = await createRole(admin, {
		name: 'Betrachter',
		permissions: ['core.roles.view', 'core.api.view', 'core.modules.view']
	});
	ids.viewer = await createUser(admin, {
		name: 'Vera Viewer',
		email: 'viewer@example.test',
		password: PW,
		roleIds: [viewer]
	});
	ids.nobody = await createUser(admin, {
		name: 'Nora Niemand',
		email: 'nobody@example.test',
		password: PW,
		roleIds: []
	});
});

afterAll(async () => {
	await close();
});

describe('/admin/roles', () => {
	it('load: 403 ohne core.roles.view', async () => {
		await expect(loadAs(rolesPage.load, 'nobody')).rejects.toMatchObject({ status: 403 });
		const data = (await loadAs(rolesPage.load, 'viewer')) as { can: Record<string, boolean> };
		expect(data.can).toEqual({ create: false, edit: false, delete: false });
	});

	it('create: 403 ohne Recht, 422 bei ungültigem Namen, Erfolg als Administrator*in', async () => {
		const denied = await act(rolesPage.actions, 'create', 'viewer', { name: 'Neu' });
		expect(denied.status).toBe(403);
		const invalid = await act(rolesPage.actions, 'create', 'admin', { name: 'x' });
		expect(invalid.status).toBe(422);
		expect(invalid.data?.message).toContain('mindestens 2 Zeichen');
		const done = await act(rolesPage.actions, 'create', 'admin', {
			name: 'Kassenprüfung',
			permissions: ['core.audit.view']
		});
		expect(done).toMatchObject({ success: true });
		expect((await listRoles(admin)).some((r) => r.name === 'Kassenprüfung')).toBe(true);
	});

	it('update/delete: 403 ohne Recht, 422 ohne ID', async () => {
		const role = (await listRoles(admin)).find((r) => r.name === 'Kassenprüfung')!;
		expect(
			(await act(rolesPage.actions, 'update', 'viewer', { id: role.id, name: 'Anders' })).status
		).toBe(403);
		expect((await act(rolesPage.actions, 'delete', 'viewer', { id: role.id })).status).toBe(403);
		expect((await act(rolesPage.actions, 'delete', 'admin', {})).status).toBe(422);
		expect(await act(rolesPage.actions, 'delete', 'admin', { id: role.id })).toMatchObject({
			success: true
		});
	});
});

describe('/admin/api', () => {
	it('load: 403 ohne core.api.view; Scopes nur aus eigenen Rechten', async () => {
		await expect(loadAs(apiPage.load, 'nobody')).rejects.toMatchObject({ status: 403 });
		const data = (await loadAs(apiPage.load, 'viewer')) as {
			scopes: { key: string }[];
			canManage: boolean;
		};
		expect(data.canManage).toBe(false);
		expect(data.scopes.map((s) => s.key).sort()).toEqual(
			['core.api.view', 'core.modules.view', 'core.roles.view'].sort()
		);
	});

	it('create/revoke: 403 ohne core.api.manage, 422 ohne Scope', async () => {
		expect(
			(await act(apiPage.actions, 'create', 'viewer', { name: 'Key', scopes: ['core.api.view'] }))
				.status
		).toBe(403);
		expect((await act(apiPage.actions, 'create', 'admin', { name: 'Key' })).status).toBe(422);
		expect((await act(apiPage.actions, 'revoke', 'viewer', { id: 'x' })).status).toBe(403);
	});
});

describe('/admin/audit', () => {
	it('load: 403 ohne core.audit.view', async () => {
		await expect(loadAs(auditPage.load, 'viewer')).rejects.toMatchObject({ status: 403 });
	});
});

describe('/admin/modules', () => {
	it('load: 403 ohne core.modules.view', async () => {
		await expect(loadAs(modulesPage.load, 'nobody')).rejects.toMatchObject({ status: 403 });
	});

	// #63 (Befund Team 9, behoben): `enable`/`disable` verlangen `core.modules.manage` – in der Action
	// (`requirePerm`) und zusätzlich im Dienst (`enableModule`/`disableModule`).
	it('enable/disable ohne core.modules.manage werden abgewiesen', async () => {
		await expect(
			act(modulesPage.actions, 'enable', 'nobody', { id: 'adminprobe' })
		).rejects.toMatchObject({ status: 403 });
		expect(await isModuleEnabled('adminprobe')).toBe(false);
		await expect(
			act(modulesPage.actions, 'disable', 'nobody', { id: 'adminprobe' })
		).rejects.toMatchObject({ status: 403 });
	});

	it('enable: Erfolg mit core.modules.manage, 422 ohne ID', async () => {
		expect((await act(modulesPage.actions, 'enable', 'admin', {})).status).toBe(422);
		expect(await act(modulesPage.actions, 'enable', 'admin', { id: 'adminprobe' })).toMatchObject({
			success: true
		});
		expect(await isModuleEnabled('adminprobe')).toBe(true);
	});
});
