import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import type { Db } from './client';

/** Wendet die Core-Migrationen (drizzle/) an. Idempotent. */
export async function runCoreMigrations(db: Db, folder = resolve(process.cwd(), 'drizzle')) {
	await migratePg(db, { migrationsFolder: folder });
}
