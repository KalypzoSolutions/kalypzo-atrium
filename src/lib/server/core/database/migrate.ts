import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import pg from 'pg';
import { env } from '../env';
import type { Db } from './client';

/** Schlüssel der Advisory-Sperre für Core- und Modul-Migrationen (feste Zahl, siehe modules/service.ts). */
export const MIGRATION_LOCK_KEY = 7_302_026_001;

/**
 * Wendet die Core-Migrationen (drizzle/) an. Idempotent.
 *
 * Mit echtem PostgreSQL hält eine eigene Verbindung währenddessen eine Advisory-Sperre: überlappen
 * zwei Starts (Rolling-Update, versehentlich zwei Replikas), wartet der zweite, bis der erste fertig
 * ist, und findet danach alle Migrationen bereits eingetragen. PGlite (Tests/Demo) ist ein einzelner
 * Prozess mit einer Sitzung und braucht keine Sperre.
 */
export async function runCoreMigrations(db: Db, folder = resolve(process.cwd(), 'drizzle')) {
	const e = env();
	if (e.DATABASE_DRIVER !== 'pg') {
		await migratePg(db, { migrationsFolder: folder });
		return;
	}
	await withMigrationLock(e.DATABASE_URL, () => migratePg(db, { migrationsFolder: folder }));
}

/** Führt `fn` unter der globalen Migrationssperre aus (Session-Lock auf eigener Verbindung). */
export async function withMigrationLock<T>(
	connectionString: string,
	fn: () => Promise<T>
): Promise<T> {
	const client = new pg.Client({ connectionString });
	await client.connect();
	try {
		await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
		try {
			return await fn();
		} finally {
			await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {
				// Verbindung weg → Sperre ist mit der Sitzung ohnehin freigegeben
			});
		}
	} finally {
		await client.end().catch((err: unknown) => {
			console.warn('[core] Verbindung der Migrationssperre ließ sich nicht schließen', err);
		});
	}
}
