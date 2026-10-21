/**
 * Upgrade-Tests für Modul-Migrationen (#64): Migrationen bis N−1 ausführen → Altdaten einfügen →
 * Migration N (und folgende) ausführen → Ergebnis prüfen. Das Modul muss registriert sein
 * (`registerModule`); aktiviert werden muss es dafür nicht.
 */
import type { SQL } from 'drizzle-orm';
import { requireDefinition } from '$lib/server/core/modules/registry';
import { runModuleMigrations } from '$lib/server/core/modules/service';
import { core } from '$lib/server/core';

type Row = Record<string, unknown>;

/** Namen der Migrationen eines Moduls in Registrierungsreihenfolge */
export function migrationNames(moduleId: string): string[] {
	return (requireDefinition(moduleId).migrations ?? []).map((m) => m.name);
}

/**
 * Führt alle noch ausstehenden Migrationen bis einschließlich `last` aus (z. B. `'0010_member_registration'`).
 * Unbekannter Name → Fehler (Tippfehler sollen nicht still „alles“ migrieren).
 */
export async function migrateModuleTo(moduleId: string, last: string): Promise<string[]> {
	const names = migrationNames(moduleId);
	const idx = names.indexOf(last);
	if (idx < 0) throw new Error(`Migration ${moduleId}/${last} unbekannt`);
	return runModuleMigrations(moduleId, undefined, { only: new Set(names.slice(0, idx + 1)) });
}

/** Führt alle restlichen Migrationen aus (wie beim Aktivieren bzw. Start nach einem Update). */
export async function migrateModuleRest(moduleId: string): Promise<string[]> {
	return runModuleMigrations(moduleId);
}

/** SQL im Modulschema ausführen (Altdaten einfügen, Ergebnis lesen) */
export async function moduleSql(moduleId: string, query: SQL): Promise<Row[]> {
	return core.database
		.forModule(moduleId)
		.transaction(
			async (tx) => ((await tx.execute(query)) as unknown as { rows: Row[] }).rows ?? []
		);
}
