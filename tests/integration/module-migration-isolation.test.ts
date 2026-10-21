import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { useTestDatabase } from '../helpers/db';
import { getDb } from '$lib/server/core/database/client';
import { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
import { runModuleMigrations } from '$lib/server/core/modules/service';

// #73 (07-06, 07-07): Modul-Migrationen laufen nur mit dem Modulschema im search_path und unter
// einer Advisory-Sperre; danach ist der search_path wieder der Standard.

function useModule(id: string, migrations: { name: string; sql: string }[]) {
	unregisterModule(id);
	registerModule({
		manifest: { id, name: id, version: '1.0.0', dependencies: [], permissions: [], navigation: [] },
		migrations
	});
}

beforeAll(async () => {
	await useTestDatabase();
});

describe('Modul-Migrationen: Isolation vom Core-Schema', () => {
	it('unqualifizierter Zugriff auf eine Core-Tabelle schlägt fehl und wird nicht eingetragen', async () => {
		useModule('iso-bad', [
			{ name: '0001_init', sql: 'CREATE TABLE IF NOT EXISTS items (id text PRIMARY KEY);' },
			{ name: '0002_touch_core', sql: 'DELETE FROM module_state WHERE false;' }
		]);
		await expect(runModuleMigrations('iso-bad')).rejects.toThrow(/module_state/);
		const res = await getDb().execute(
			sql`SELECT count(*)::int AS n FROM module_migration WHERE module_id = 'iso-bad'`
		);
		// ganze Transaktion zurückgerollt: auch 0001 nicht eingetragen
		expect(Number((res.rows[0] as { n: number }).n)).toBe(0);
	});

	it('Modultabelle mit Core-Namen überschattet die Core-Tabelle nicht', async () => {
		useModule('iso-shadow', [
			{ name: '0001_init', sql: 'CREATE TABLE IF NOT EXISTS module_migration (x int);' },
			{ name: '0002_more', sql: 'CREATE TABLE IF NOT EXISTS other (id int);' }
		]);
		expect(await runModuleMigrations('iso-shadow')).toEqual(['0001_init', '0002_more']);
		const core = await getDb().execute(
			sql`SELECT name FROM public.module_migration WHERE module_id = 'iso-shadow' ORDER BY name`
		);
		expect(core.rows.map((r) => (r as { name: string }).name)).toEqual(['0001_init', '0002_more']);
		const modTable = await getDb().execute(
			sql`SELECT count(*)::int AS n FROM mod_iso_shadow.module_migration`
		);
		expect(Number((modTable.rows[0] as { n: number }).n)).toBe(0);
	});

	it('search_path ist nach der Migration in derselben Transaktion wieder Standard', async () => {
		useModule('iso-path', [
			{ name: '0001_init', sql: 'CREATE TABLE IF NOT EXISTS items (id text PRIMARY KEY);' }
		]);
		const path = await getDb().transaction(async (tx) => {
			await runModuleMigrations('iso-path', tx);
			const r = await tx.execute(sql`SHOW search_path`);
			return String((r.rows[0] as { search_path: string }).search_path);
		});
		expect(path).not.toContain('mod_iso_path');
		expect(path).toContain('public');
	});

	it('nimmt die Migrationssperre bis Transaktionsende', async () => {
		useModule('iso-lock', [
			{ name: '0001_init', sql: 'CREATE TABLE IF NOT EXISTS items (id text PRIMARY KEY);' }
		]);
		const held = await getDb().transaction(async (tx) => {
			await runModuleMigrations('iso-lock', tx);
			const r = await tx.execute(
				sql`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND granted`
			);
			return Number((r.rows[0] as { n: number }).n);
		});
		expect(held).toBeGreaterThan(0);
	});
});
