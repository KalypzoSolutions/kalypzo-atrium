/**
 * Modul `material` – Migration 0002 (Artikel-Codes): Artikel im Zustand „vor 0002“ bekommen fortlaufende
 * Codes `A-000001 …` nach Anlagedatum, der Zähler wird fortgeschrieben, Etikett-Layouts kennen das Ziel `article`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { migrateModuleRest, migrateModuleTo, moduleSql } from '../helpers/migrations';
import { registerModule } from '$lib/server/core/modules/registry';
import materialModule from '$lib/modules/material/module';

let close: () => Promise<void>;

beforeAll(async () => {
	({ close } = await useTestDatabase());
	registerModule(materialModule);
});

afterAll(async () => {
	await close();
});

describe('material 0002_article_codes', () => {
	it('vergibt Codes nach Anlagedatum und setzt den Zähler', async () => {
		await migrateModuleTo('material', '0001_init');
		await moduleSql(
			'material',
			sql`INSERT INTO articles (id, name, kind, created_at) VALUES
				('00000000-0000-4000-8000-000000000002', 'Tasse', 'bulk', '2026-01-02T10:00:00Z'),
				('00000000-0000-4000-8000-000000000001', 'Kohtenbahn', 'unit', '2026-01-01T10:00:00Z'),
				('00000000-0000-4000-8000-000000000003', 'Axt', 'unit', '2026-01-03T10:00:00Z')`
		);
		expect(await migrateModuleRest('material')).toEqual(['0002_article_codes']);
		const rows = await moduleSql('material', sql`SELECT name, code FROM articles ORDER BY code`);
		expect(rows).toEqual([
			{ name: 'Kohtenbahn', code: 'A-000001' },
			{ name: 'Tasse', code: 'A-000002' },
			{ name: 'Axt', code: 'A-000003' }
		]);
		const [counter] = await moduleSql(
			'material',
			sql`SELECT value FROM code_counters WHERE prefix = 'A'`
		);
		expect(Number(counter!.value)).toBe(3);
		// Ziel `article` ist erlaubt, Code ist Pflicht und eindeutig
		await moduleSql(
			'material',
			sql`INSERT INTO label_templates (id, name, target, layout, format_key)
				VALUES ('00000000-0000-4000-8000-0000000000aa', 'Regal', 'article', '{}'::jsonb, 'avery-l7159')`
		);
		await expect(
			moduleSql(
				'material',
				sql`INSERT INTO articles (id, name, kind, code) VALUES ('00000000-0000-4000-8000-000000000004', 'X', 'bulk', 'A-000001')`
			)
		).rejects.toThrow();
	});
});
