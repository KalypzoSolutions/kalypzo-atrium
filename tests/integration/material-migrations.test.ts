/**
 * Modul `material` – Migration 0002 (Artikel-Codes): Artikel im Zustand „vor 0002“ bekommen fortlaufende
 * Codes `A-000001 …` nach Anlagedatum, der Zähler wird fortgeschrieben, Etikett-Layouts kennen das Ziel `article`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { useTestDatabase } from '../helpers/db';
import { migrateModuleTo, moduleSql } from '../helpers/migrations';
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
		expect(await migrateModuleTo('material', '0002_article_codes')).toEqual(['0002_article_codes']);
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

describe('material 0004_rebuild', () => {
	it('verwirft den alten Bestand und stellt Etikett-Layouts auf die neuen Ziele um', async () => {
		// Zustand nach 0002 aus dem Test oben: Artikel + Layout mit Ziel `article`
		expect(await migrateModuleTo('material', '0003_set_bulk_lines')).toEqual([
			'0003_set_bulk_lines'
		]);
		await moduleSql(
			'material',
			sql`INSERT INTO locations (id, name, code) VALUES
				('00000000-0000-4000-8000-0000000000b1', 'Keller', 'L-000001')`
		);
		await moduleSql(
			'material',
			sql`INSERT INTO label_templates (id, name, target, layout, format_key) VALUES
				('00000000-0000-4000-8000-0000000000ab', 'Stück', 'unit',
					'{"elements":[{"text":"{article} {name}"}]}'::jsonb, 'avery-l7159'),
				('00000000-0000-4000-8000-0000000000ac', 'Ort', 'location', '{}'::jsonb, 'avery-l7159')`
		);
		await moduleSql(
			'material',
			sql`INSERT INTO label_formats (id, name, format) VALUES
				('00000000-0000-4000-8000-0000000000ad', 'Eigen', '{"kind":"roll"}'::jsonb)`
		);
		await moduleSql('material', sql`INSERT INTO code_counters (prefix, value) VALUES ('M', 7)`);

		expect(await migrateModuleTo('material', '0004_rebuild')).toEqual(['0004_rebuild']);

		const templates = await moduleSql(
			'material',
			sql`SELECT name, target, layout::text AS layout FROM label_templates ORDER BY name`
		);
		expect(templates.map((t) => [t.name, t.target])).toEqual([
			['Ort', 'location'],
			['Regal', 'item'],
			['Stück', 'item']
		]);
		expect(String(templates.find((t) => t.name === 'Stück')!.layout)).toContain('{type} {name}');
		expect(await moduleSql('material', sql`SELECT name FROM label_formats`)).toEqual([
			{ name: 'Eigen' }
		]);
		const counters = await moduleSql(
			'material',
			sql`SELECT prefix, value FROM code_counters ORDER BY prefix`
		);
		expect(counters.map((c) => [c.prefix, Number(c.value)])).toEqual([['M', 7]]);
		// Alte Tabellen sind weg, neue leer
		await expect(moduleSql('material', sql`SELECT 1 FROM articles`)).rejects.toThrow();
		expect(await moduleSql('material', sql`SELECT id FROM locations`)).toEqual([]);
		expect(await moduleSql('material', sql`SELECT id FROM items`)).toEqual([]);
		await expect(
			moduleSql(
				'material',
				sql`INSERT INTO label_templates (id, name, target, layout, format_key)
					VALUES ('00000000-0000-4000-8000-0000000000ae', 'X', 'set', '{}'::jsonb, 'avery-l7159')`
			)
		).rejects.toThrow();
		expect(
			await moduleSql('material', sql`SELECT id FROM legacy_cleanup WHERE done_at IS NULL`)
		).toEqual([{ id: 'v1-images' }]);
	});
});
