import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Gemeinsame Basis für Funktionen, die mit Datenbank oder Transaktion arbeiten */
export type DbOrTx = Db | Tx;

interface State {
	db: Db;
	close: () => Promise<void>;
}

const globalKey = Symbol.for('ep-intern.db');
type G = typeof globalThis & { [globalKey]?: State };

function create(): State {
	const e = env();
	if (e.DATABASE_DRIVER === 'pglite') {
		throw new Error(
			'PGlite muss vor dem ersten Zugriff über useTestDatabase() initialisiert werden.'
		);
	}
	const pool = new pg.Pool({ connectionString: e.DATABASE_URL, max: e.DATABASE_POOL_MAX });
	return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

/** Zentrale Datenbankverbindung (Singleton pro Prozess). */
export function getDb(): Db {
	const g = globalThis as G;
	g[globalKey] ??= create();
	return g[globalKey].db;
}

/** Ersetzt die Verbindung (Tests, PGlite). */
export function setDb(db: Db, close: () => Promise<void> = async () => {}): void {
	(globalThis as G)[globalKey] = { db, close };
}

export async function closeDb(): Promise<void> {
	const g = globalThis as G;
	await g[globalKey]?.close();
	delete g[globalKey];
}

export { schema };
