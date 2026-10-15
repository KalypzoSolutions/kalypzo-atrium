import { sql } from 'drizzle-orm';
import { moduleSchemaName } from '../modules/types';
import { getDb, type Db, type Tx } from './client';

export interface ModuleDatabase {
	/** PostgreSQL-Schema des Moduls (`mod_<id>`) */
	readonly schemaName: string;
	/**
	 * Transaktion mit `search_path` = Modulschema. Unqualifizierte Tabellen loesen
	 * ausschliesslich im eigenen Schema auf; Core- und Fremdtabellen sind nicht erreichbar.
	 */
	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export function forModule(moduleId: string): ModuleDatabase {
	const schemaName = moduleSchemaName(moduleId);
	return {
		schemaName,
		transaction: (fn) =>
			getDb().transaction(async (tx) => {
				await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}"`));
				return fn(tx);
			})
	};
}

/** Core-interne Transaktion (nicht fuer Module gedacht, siehe `core.database.forModule`). */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
	return getDb().transaction(fn);
}

export type { Db, Tx };
