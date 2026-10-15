import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { resolve } from 'node:path';
import { setDb, schema, type Db } from '$lib/server/core/database/client';
import { resetAuthForTests } from '$lib/server/core/auth';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { invalidateModuleStateCache } from '$lib/server/core/modules/state';

/** Frische In-Memory-PostgreSQL-Instanz (PGlite) mit allen Core-Migrationen. */
export async function useTestDatabase(): Promise<{ db: Db; close: () => Promise<void> }> {
	const client = new PGlite();
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
	setDb(db as unknown as Db, async () => client.close());
	resetAuthForTests();
	resetAllForTests();
	invalidateModuleStateCache();
	return { db: db as unknown as Db, close: () => client.close() };
}
