/**
 * #68 (02-12): Caches im Request-Grundpfad.
 * - `getUserPermissions` (Session-Kontext) nutzt den Modulstatus-Cache: bei warmem Cache keine
 *   Abfrage von `module_state` (nachgewiesen über eine direkte DB-Änderung, die erst nach
 *   Invalidierung wirkt)
 * - Storage-Konfiguration: Cache bis zur Invalidierung bzw. TTL; Speichern invalidiert (siehe
 *   `storage-batch-images.test.ts`)
 * - SMTP-Einstellungen: dasselbe Muster (`mail-transport.test.ts`)
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { getDb, schema } from '$lib/server/core/database/client';
import { registerModule } from '$lib/server/core/modules/registry';
import { enableModule, syncModules } from '$lib/server/core/modules/service';
import { invalidateModuleStateCache } from '$lib/server/core/modules/state';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { setSetting } from '$lib/server/core/settings/service';
import { invalidateStorageConfigCache, loadConfig } from '$lib/server/core/storage';
import eventsModule from '$lib/modules/events/module';
import membersModule from '$lib/modules/members/module';

let close: () => Promise<void>;
let adminId = '';

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerCoreApi();
	registerModule(membersModule);
	registerModule(eventsModule);
	await syncModules();
	await bootstrapAdmin('admin@example.test', 'correct-horse-battery');
	const [u] = await getDb()
		.select()
		.from(schema.user)
		.where(eq(schema.user.email, 'admin@example.test'));
	adminId = u!.id;
	const admin = (await contextForUser(adminId))!.ctx;
	await enableModule(admin, 'members');
	await enableModule(admin, 'events');
});

afterAll(async () => {
	await close();
});

const perms = async () => (await contextForUser(adminId))!.ctx.permissions;

describe('Modulstatus-Cache im Session-Pfad', () => {
	it('warmer Cache: keine module_state-Abfrage je Request', async () => {
		invalidateModuleStateCache();
		expect((await perms()).has('events.event.view')).toBe(true); // wärmt den Cache
		// Direkt in der DB deaktivieren (ohne Invalidierung) – der Cache antwortet weiter
		await getDb().execute(sql`UPDATE module_state SET enabled = false WHERE id = 'events'`);
		expect((await perms()).has('events.event.view')).toBe(true);
		invalidateModuleStateCache();
		expect((await perms()).has('events.event.view')).toBe(false);
		await getDb().execute(sql`UPDATE module_state SET enabled = true WHERE id = 'events'`);
		invalidateModuleStateCache();
		expect((await perms()).has('events.event.view')).toBe(true);
	});
});

describe('Storage-Konfiguration', () => {
	it('liest die Einstellungen nicht je Operation neu', async () => {
		const admin = (await contextForUser(adminId))!.ctx;
		await setSetting(admin, 'core.storage.bucket', 'eins');
		expect((await loadConfig()).bucket).toBe('eins');
		await getDb().execute(
			sql`UPDATE setting SET value = '"zwei"'::jsonb WHERE key = 'core.storage.bucket'`
		);
		expect((await loadConfig()).bucket).toBe('eins');
		invalidateStorageConfigCache();
		expect((await loadConfig()).bucket).toBe('zwei');
	});
});
