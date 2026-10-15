import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	FIELD_TYPES,
	getFieldType,
	listFieldTypes,
	registerFieldType,
	type FieldTypeSpec,
	type TextField
} from '$lib/forms';

describe('Feldtypen-Registry', () => {
	it('enthält alle Standardtypen in Reihenfolge', () => {
		expect(listFieldTypes().map((s) => s.type)).toEqual([...FIELD_TYPES]);
	});

	it('hasValue nur bei info false; Labels deutsch', () => {
		for (const s of listFieldTypes()) {
			expect(s.hasValue).toBe(s.type !== 'info');
			expect(s.label.length).toBeGreaterThan(0);
			expect(s.icon.length).toBeGreaterThan(0);
		}
		expect(getFieldType('text').label).toBe('Kurztext');
	});

	it('unbekannter Typ → Fehler mit Typname', () => {
		expect(() => getFieldType('hologramm')).toThrow(/hologramm/);
	});

	it('doppelte Registrierung → Fehler', () => {
		const spec: FieldTypeSpec<TextField> = {
			type: 'text',
			label: 'x',
			icon: 'box',
			hasValue: true,
			create: (id, key) => ({ id, key, type: 'text', label: 'x' }),
			schema: () => z.string()
		};
		expect(() => registerFieldType(spec)).toThrow(/text/);
	});

	it('create liefert passenden Typ und Schlüssel', () => {
		for (const s of listFieldTypes()) {
			const field = s.create('id1', 'key1');
			expect(field.type).toBe(s.type);
			expect(field.id).toBe('id1');
			expect(field.key).toBe('key1');
		}
		const consent = getFieldType('consent').create('a', 'b');
		expect(consent.required).toBe(true);
	});
});
