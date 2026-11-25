import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const marketplace = readFileSync('drizzle/0014_marketplace_cache.sql', 'utf8');
const reconcile = readFileSync('drizzle/0015_module_updates_reconcile.sql', 'utf8');
const updates = reconcile.slice(0, reconcile.lastIndexOf('--> statement-breakpoint'));

describe('Zusammenführung der Migration 0014', () => {
	for (const [stand, previous] of [
		['main', marketplace],
		['extern', updates],
		['neu', '']
	] as const) {
		it(`ergänzt beide Schemateile auf ${stand} und ist wiederholbar`, async () => {
			const db = new PGlite();
			try {
				await db.exec('CREATE TABLE module_install (id text PRIMARY KEY)');
				if (previous) await db.exec(previous);
				await db.exec(reconcile);
				await db.exec(reconcile);
				const tables = await db.query<{ name: string }>(
					"SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'"
				);
				expect(tables.rows.map((row) => row.name)).toEqual(
					expect.arrayContaining(['marketplace_cache', 'module_update_check'])
				);
				const columns = await db.query<{ name: string }>(
					"SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'module_install'"
				);
				expect(columns.rows.map((row) => row.name)).toEqual(
					expect.arrayContaining(['channel', 'ignored_update'])
				);
			} finally {
				await db.close();
			}
		});
	}
});
