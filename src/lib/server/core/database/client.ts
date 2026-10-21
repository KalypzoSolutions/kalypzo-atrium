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
	/** Mehrere Verbindungen (echter `pg`-Pool mit `max > 1`) – parallele Abfragen sinnvoll */
	concurrent: boolean;
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
	return {
		db: drizzle(pool, { schema }),
		close: () => pool.end(),
		concurrent: e.DATABASE_POOL_MAX > 1
	};
}

/** Zentrale Datenbankverbindung (Singleton pro Prozess). */
export function getDb(): Db {
	const g = globalThis as G;
	g[globalKey] ??= create();
	return g[globalKey].db;
}

/**
 * Ersetzt die Verbindung (Tests, PGlite). `concurrent: true` nur für einen echten Pool mit
 * mehreren Verbindungen (PGlite hat eine Sitzung → Standard `false`).
 */
export function setDb(
	db: Db,
	close: () => Promise<void> = async () => {},
	opts: { concurrent?: boolean } = {}
): void {
	(globalThis as G)[globalKey] = { db, close, concurrent: opts.concurrent ?? false };
}

/**
 * Dürfen unabhängige Abfragen parallel laufen? Nur mit echtem Pool (> 1 Verbindung); PGlite und
 * `DATABASE_POOL_MAX=1` (Demo) arbeiten strikt nacheinander (#68, globale Suche).
 */
export function databaseAllowsParallelQueries(): boolean {
	getDb();
	return (globalThis as G)[globalKey]?.concurrent ?? false;
}

export async function closeDb(): Promise<void> {
	const g = globalThis as G;
	await g[globalKey]?.close();
	delete g[globalKey];
}

export { schema };
