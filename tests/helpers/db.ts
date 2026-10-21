import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { setDb, schema, type Db } from '$lib/server/core/database/client';
import { runCoreMigrations } from '$lib/server/core/database/migrate';
import { resetEnvForTests } from '$lib/server/core/env';
import { resetAuthForTests } from '$lib/server/core/auth';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { invalidateModuleStateCache } from '$lib/server/core/modules/state';
import { invalidateStorageConfigCache } from '$lib/server/core/storage/config-cache';
import { invalidateMailTransportCache } from '$lib/server/core/mail-cache';

/**
 * Echte PostgreSQL-Instanz für Integrationstests (#60), z. B.
 * `TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres`.
 * Ohne Variable laufen alle Tests wie bisher gegen PGlite (eine Sitzung, kein Docker).
 */
export const pgTestUrl = (): string | undefined =>
	process.env.TEST_DATABASE_URL?.trim() || undefined;

/**
 * `true`, wenn die Tests gegen einen echten PostgreSQL-Server laufen (nicht PGlite, auch nicht
 * PGlite über einen Socket-Server). Nur dann sind Sperren und Wettläufe wirklich nebenläufig.
 */
export async function isRealPostgres(): Promise<boolean> {
	const url = pgTestUrl();
	if (!url) return false;
	const c = new pg.Client({ connectionString: url });
	await c.connect();
	try {
		const r = await c.query<{ v: string }>('SELECT version() AS v');
		return !/pglite/i.test(r.rows[0]?.v ?? '');
	} finally {
		await c.end();
	}
}

const once = (fn: () => Promise<void>) => {
	let p: Promise<void> | undefined;
	return () => (p ??= fn());
};

/** Alle Tabellen der Anwendung entfernen (Modus `TEST_DATABASE_ISOLATION=reset`). */
async function resetSchemas(url: string): Promise<void> {
	const c = new pg.Client({ connectionString: url });
	await c.connect();
	try {
		await c.query(`DO $$
			DECLARE s text;
			BEGIN
				FOR s IN SELECT nspname FROM pg_namespace
					WHERE nspname LIKE 'mod\\_%' OR nspname IN ('drizzle', 'public')
				LOOP
					EXECUTE format('DROP SCHEMA %I CASCADE', s);
				END LOOP;
			END $$`);
		await c.query('CREATE SCHEMA public');
	} finally {
		await c.end();
	}
}

/**
 * Je Testdatei eine eigene, frische Datenbank (`ept_<pid>_<zufall>`) auf dem Server aus
 * `TEST_DATABASE_URL`; Pool mit `TEST_DATABASE_POOL_MAX` (Standard 4) Verbindungen, damit
 * parallele Requests/Transaktionen wirklich gleichzeitig laufen. `close()` löscht die Datenbank.
 *
 * `TEST_DATABASE_ISOLATION=reset`: statt einer neuen Datenbank die angegebene leeren (für Server ohne
 * `CREATEDB`-Recht oder PGlite-Socket); dann nur eine Testdatei gleichzeitig (`--no-file-parallelism`).
 */
async function usePostgresDatabase(
	baseUrl: string
): Promise<{ db: Db; close: () => Promise<void> }> {
	let url = baseUrl;
	let dropDatabase = async () => {};
	if (process.env.TEST_DATABASE_ISOLATION === 'reset') {
		await resetSchemas(url);
	} else {
		const name = `ept_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
		const admin = new pg.Client({ connectionString: baseUrl });
		await admin.connect();
		try {
			await admin.query(`CREATE DATABASE "${name}"`);
		} finally {
			await admin.end();
		}
		const u = new URL(baseUrl);
		u.pathname = `/${name}`;
		url = u.toString();
		dropDatabase = async () => {
			const c = new pg.Client({ connectionString: baseUrl });
			await c.connect();
			try {
				await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
			} finally {
				await c.end();
			}
		};
	}
	// Produktionspfad: `pg`-Treiber, Migrationssperre in runCoreMigrations nutzt DATABASE_URL
	process.env.DATABASE_DRIVER = 'pg';
	process.env.DATABASE_URL = url;
	resetEnvForTests();
	const max = Number(process.env.TEST_DATABASE_POOL_MAX ?? 4) || 4;
	const pool = new pg.Pool({ connectionString: url, max });
	const db = drizzlePg(pool, { schema }) as unknown as Db;
	const close = once(async () => {
		await pool.end();
		await dropDatabase();
	});
	try {
		await runCoreMigrations(db);
	} catch (e) {
		await close();
		throw e;
	}
	setDb(db, close, { concurrent: max > 1 });
	return { db, close };
}

function resetCaches(): void {
	resetAuthForTests();
	resetAllForTests();
	invalidateModuleStateCache();
	invalidateStorageConfigCache();
	invalidateMailTransportCache();
}

/**
 * Frische Datenbank mit allen Core-Migrationen: standardmäßig In-Memory-PGlite, mit
 * `TEST_DATABASE_URL` echtes PostgreSQL über den `pg`-Treiber (siehe `usePostgresDatabase`).
 */
export async function useTestDatabase(): Promise<{ db: Db; close: () => Promise<void> }> {
	const url = pgTestUrl();
	if (url) {
		const r = await usePostgresDatabase(url);
		resetCaches();
		return r;
	}
	const client = new PGlite();
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
	setDb(db as unknown as Db, async () => client.close());
	resetCaches();
	return { db: db as unknown as Db, close: () => client.close() };
}
