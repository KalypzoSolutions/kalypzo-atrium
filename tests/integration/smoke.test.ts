import { beforeAll, describe, expect, it } from 'bun:test';
import { getDb, schema } from '$lib/server/core/database/client';
import { useTestDatabase } from '../helpers/db';

describe('smoke', () => {
	beforeAll(async () => {
		await useTestDatabase();
	});
	it('migrations laufen und audit_log ist unveränderlich', async () => {
		const db = getDb();
		await db.insert(schema.auditLog).values({ id: 'a1', action: 'x.y.z', actorType: 'system' });
		// `.execute()`: Drizzle-Builder sind nur „thenable“, `expect().rejects` braucht ein echtes Promise
		await expect(db.update(schema.auditLog).set({ action: 'changed' }).execute()).rejects.toThrow();
	});
});
