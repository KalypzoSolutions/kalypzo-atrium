import { getDb, schema, type DbOrTx } from '../database/client';

/** Kurzer Cache: Laufzeitaktivierung muss schnell wirken, aber nicht jede Anfrage kostet eine Query. */
const TTL_MS = 3000;
let cache: { at: number; ids: Set<string> } | undefined;

export function invalidateModuleStateCache(): void {
	cache = undefined;
}

export async function enabledModuleIds(tx?: DbOrTx): Promise<Set<string>> {
	if (!tx && cache && Date.now() - cache.at < TTL_MS) return cache.ids;
	const db = tx ?? getDb();
	const rows = await db
		.select({ id: schema.moduleState.id, enabled: schema.moduleState.enabled })
		.from(schema.moduleState);
	const ids = new Set(rows.filter((r) => r.enabled).map((r) => r.id));
	if (!tx) cache = { at: Date.now(), ids };
	return ids;
}
