/**
 * Datenbank-Grundhelfer für Module: Modul-Datenbank, Zeilen aus `tx.execute`, ID-Listen, Zeitstempel und
 * Spaltenwerte. Ersetzt die früher in jedem Modul kopierten `mdb`/`rowsOf`/`iso`/`idList` (#70).
 *
 *   import { moduleDb, rowsOf, inList, toIso } from '$lib/sdk/server';
 *   const rows = await moduleDb(MODULE_ID).transaction((tx) => rowsOf(tx, sql`SELECT …`));
 */
import { core } from '$lib/server/core';

export {
	inList,
	num,
	resultRows,
	rowsOf,
	str,
	toIso,
	toIsoOrNull,
	type Row
} from '$lib/server/core/database/rows';

/** Datenbank des Moduls (`core.database.forModule(id)`): `transaction` mit `search_path` auf `mod_<id>` */
export const moduleDb = (moduleId: string) => core.database.forModule(moduleId);

/** Anzeigename aus einer `core.users.byIds`-Map; unbekannt/gelöscht/deaktiviert → `fallback` („Unbekannt“) */
export function userLabel(
	users: ReadonlyMap<string, { name: string }>,
	id: string | null | undefined,
	fallback = 'Unbekannt'
): string {
	return (id ? users.get(id)?.name : undefined) ?? fallback;
}
