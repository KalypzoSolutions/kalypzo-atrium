/**
 * Phase N: Der API-Router führt Handler in der Sprache des Kontos aus (Besitzer*in des API-Keys bzw. Session),
 * ohne Kontowahl in der Sprache des Requests. Endpunkt-Texte (Zusammenfassungen, Rechte) kommen übersetzt.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { t } from '$lib/i18n';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { createApiKey } from '$lib/server/core/api/keys';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { registerCoreEndpoints } from '$lib/server/core/api/registry';
import { handleApiRequest } from '$lib/server/core/api/router';
import { syncModules } from '$lib/server/core/modules/service';
import { listPermissions } from '$lib/server/core/permissions/service';
import {
	installServerLocale,
	invalidateUserLocale,
	withLocale
} from '$lib/server/core/i18n/locale';
import { resetAllForTests } from '$lib/server/core/rate-limit';

const ROOT = 'http://localhost:5173/api/v1';
let close: () => Promise<void>;
let key: string;
let adminId: string;

async function call(path: string, auth = true) {
	resetAllForTests();
	const url = new URL(`${ROOT}${path}`);
	const headers: Record<string, string> = auth ? { authorization: `Bearer ${key}` } : {};
	const res = await handleApiRequest({
		request: new Request(url, { headers }),
		url,
		ip: '127.0.0.1'
	});
	return { status: res.status, body: await res.json() };
}

async function setOwnLocale(value: string | null) {
	const db = getDb();
	await db.delete(schema.setting).where(eq(schema.setting.scopeId, adminId));
	if (value)
		await db.insert(schema.setting).values({ key: 'core.user.locale', scopeId: adminId, value });
	invalidateUserLocale(adminId);
}

beforeAll(async () => {
	({ close } = await useTestDatabase());
	await installServerLocale();
	registerCoreApi();
	registerCoreEndpoints([
		{
			method: 'GET',
			path: '/locale-probe',
			summary: 's',
			permission: null,
			authenticated: true,
			handler: () => ({ text: t('errors.notFound') })
		}
	]);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [a] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = a!.id;
	const ctx = (await contextForUser(adminId))!.ctx;
	({ key } = await createApiKey(ctx, { name: 'Sprache', scopes: ['core.users.view'] }));
});

afterAll(async () => {
	await close();
});

describe('API in der Sprache des Kontos', () => {
	it('ohne Kontowahl: Sprache des Requests', async () => {
		await setOwnLocale(null);
		expect((await call('/locale-probe')).body.data.text).toBe('Nicht gefunden');
		const en = await withLocale('en', () => call('/locale-probe'));
		expect(en.body.data.text).toBe('Not found');
	});

	it('Konto auf Englisch: Handler und Fehler auf Englisch, auch im deutschen Request', async () => {
		await setOwnLocale('en');
		expect((await call('/locale-probe')).body.data.text).toBe('Not found');
		const denied = await call('/roles');
		expect(denied.status).toBe(403);
		expect(denied.body.error.message).toBe('Missing permission: core.roles.view');
		await setOwnLocale(null);
	});

	it('vor der Anmeldung: Fehler in der Sprache des Requests', async () => {
		const res = await withLocale('en', () => call('/locale-probe', false));
		expect(res.status).toBe(401);
		expect(res.body.error.message).toBe('Authentication required');
	});

	it('Rechte-Beschreibungen und Endpunkt-Texte je Sprache', async () => {
		const de = (await listPermissions()).find((p) => p.key === 'core.users.view');
		expect(de?.description).toBe('Benutzer ansehen');
		const en = await withLocale('en', async () =>
			(await listPermissions()).find((p) => p.key === 'core.users.view')
		);
		expect(en?.description).toBe('View users');
		const stored = await getDb()
			.select()
			.from(schema.permission)
			.where(eq(schema.permission.key, 'core.users.view'));
		expect(stored[0]!.description).toBe('Benutzer ansehen');
	});
});
