import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { getDb, schema } from '$lib/server/core/database/client';

describe('smoke', () => {
	beforeAll(async () => {
		await useTestDatabase();
	});
	it('migrations laufen und audit_log ist unveränderlich', async () => {
		const db = getDb();
		await db.insert(schema.auditLog).values({ id: 'a1', action: 'x.y.z', actorType: 'system' });
		await expect(db.update(schema.auditLog).set({ action: 'changed' })).rejects.toThrow();
	});
});
