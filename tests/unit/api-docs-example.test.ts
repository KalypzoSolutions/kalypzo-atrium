import { describe, expect, it } from 'vitest';
import { exampleFromSchema, exampleJson } from '../../src/lib/api-docs/example';
import type { JsonSchema } from '../../src/lib/api-docs/types';

describe('exampleFromSchema – Vorrang', () => {
	it('examples[0] vor default vor const vor enum', () => {
		expect(exampleFromSchema({ type: 'string', examples: ['a'], default: 'b', const: 'c' })).toBe(
			'a'
		);
		expect(exampleFromSchema({ type: 'string', default: 'b', const: 'c', enum: ['d'] })).toBe('b');
		expect(exampleFromSchema({ type: 'string', const: 'c', enum: ['d'] })).toBe('c');
		expect(exampleFromSchema({ type: 'string', enum: ['d', 'e'] })).toBe('d');
		expect(exampleFromSchema({ enum: [null, 'x'] })).toBe('x');
	});

	it('leere examples-Liste wird ignoriert, default false/0 gilt', () => {
		expect(exampleFromSchema({ type: 'integer', examples: [], default: 0, minimum: 5 })).toBe(0);
		expect(exampleFromSchema({ type: 'boolean', default: true })).toBe(true);
	});

	it('liefert Kopien statt Referenzen', () => {
		const schema: JsonSchema = { type: 'object', default: { a: 1 } };
		const value = exampleFromSchema(schema) as { a: number };
		value.a = 2;
		expect(schema.default).toEqual({ a: 1 });
	});
});

describe('exampleFromSchema – Strings', () => {
	it('Formate', () => {
		expect(exampleFromSchema({ type: 'string', format: 'date' })).toBe('2026-01-31');
		expect(exampleFromSchema({ type: 'string', format: 'date-time' })).toBe(
			'2026-01-31T12:00:00.000Z'
		);
		expect(exampleFromSchema({ type: 'string', format: 'email' })).toBe('name@example.org');
		expect(exampleFromSchema({ type: 'string', format: 'uuid' })).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
		);
		expect(exampleFromSchema({ type: 'string', format: 'uri' })).toBe('https://example.org');
	});

	it('Datums-Pattern', () => {
		expect(exampleFromSchema({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })).toBe(
			'2026-01-31'
		);
	});

	it('minLength/maxLength', () => {
		expect(exampleFromSchema({ type: 'string' })).toBe('text');
		expect(exampleFromSchema({ type: 'string', minLength: 4 })).toBe('text');
		expect(exampleFromSchema({ type: 'string', minLength: 6 })).toBe('textxx');
		expect(exampleFromSchema({ type: 'string', maxLength: 2 })).toBe('te');
		expect(exampleFromSchema({ type: 'string', maxLength: 0 })).toBe('');
	});
});

describe('exampleFromSchema – Zahlen und Boolean', () => {
	it('integer', () => {
		expect(exampleFromSchema({ type: 'integer' })).toBe(0);
		expect(exampleFromSchema({ type: 'integer', minimum: 1 })).toBe(1);
		expect(exampleFromSchema({ type: 'integer', minimum: 1.5 })).toBe(2);
		expect(exampleFromSchema({ type: 'integer', exclusiveMinimum: 0 })).toBe(1);
		expect(exampleFromSchema({ type: 'integer', maximum: -3 })).toBe(-3);
		expect(exampleFromSchema({ type: 'integer', exclusiveMaximum: 0 })).toBe(-1);
		expect(exampleFromSchema({ type: 'integer', minimum: 10, maximum: 10 })).toBe(10);
	});

	it('number', () => {
		expect(exampleFromSchema({ type: 'number' })).toBe(0);
		expect(exampleFromSchema({ type: 'number', exclusiveMinimum: 0.5 })).toBe(1.5);
		expect(exampleFromSchema({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 })).toBe(
			0.5
		);
		expect(exampleFromSchema({ type: 'number', maximum: -1.5 })).toBe(-1.5);
	});

	it('boolean', () => {
		expect(exampleFromSchema({ type: 'boolean' })).toBe(false);
	});
});

describe('exampleFromSchema – Arrays und Objekte', () => {
	it('Arrays mit minItems/maxItems', () => {
		expect(exampleFromSchema({ type: 'array', items: { type: 'integer' } })).toEqual([0]);
		expect(exampleFromSchema({ type: 'array', items: { type: 'integer' }, minItems: 2 })).toEqual([
			0, 0
		]);
		expect(exampleFromSchema({ type: 'array', items: { type: 'integer' }, minItems: 5 })).toEqual([
			0, 0
		]);
		expect(exampleFromSchema({ type: 'array', items: { type: 'integer' }, maxItems: 0 })).toEqual(
			[]
		);
		expect(exampleFromSchema({ type: 'array' })).toEqual([]);
	});

	const user: JsonSchema = {
		type: 'object',
		properties: {
			id: { type: 'string', format: 'uuid' },
			name: { type: 'string', minLength: 1 },
			note: { type: ['string', 'null'] },
			tags: { type: 'array', items: { type: 'string' } }
		},
		required: ['id', 'name']
	};

	it('Objekt mit allen Properties', () => {
		expect(exampleFromSchema(user)).toEqual({
			id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
			name: 'text',
			note: 'text',
			tags: ['text']
		});
	});

	it('requiredOnly', () => {
		expect(exampleFromSchema(user, { requiredOnly: true })).toEqual({
			id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
			name: 'text'
		});
	});

	it('verschachtelt', () => {
		const schema: JsonSchema = {
			type: 'object',
			properties: {
				items: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							amountCents: { type: 'integer', minimum: 0 },
							date: { format: 'date', type: 'string' }
						},
						required: ['amountCents']
					}
				}
			}
		};
		expect(exampleFromSchema(schema)).toEqual({
			items: [{ amountCents: 0, date: '2026-01-31' }]
		});
	});

	it('Objekt ohne type, nur properties; additionalProperties', () => {
		expect(exampleFromSchema({ properties: { a: { type: 'boolean' } } })).toEqual({ a: false });
		expect(exampleFromSchema({ type: 'object', additionalProperties: { type: 'string' } })).toEqual(
			{}
		);
	});
});

describe('exampleFromSchema – Kombinationen und Nullable', () => {
	it('anyOf/oneOf → erste Nicht-null-Variante', () => {
		expect(exampleFromSchema({ anyOf: [{ type: 'null' }, { type: 'integer', minimum: 3 }] })).toBe(
			3
		);
		expect(
			exampleFromSchema({ oneOf: [{ type: 'string', format: 'email' }, { type: 'integer' }] })
		).toBe('name@example.org');
		expect(exampleFromSchema({ anyOf: [{ type: 'null' }] })).toBeNull();
	});

	it('allOf wird zusammengeführt', () => {
		expect(
			exampleFromSchema({
				allOf: [
					{ type: 'object', properties: { a: { type: 'integer' } }, required: ['a'] },
					{ properties: { b: { type: 'boolean' } }, required: ['b'] }
				]
			})
		).toEqual({ a: 0, b: false });
	});

	it('type als Array und nullable', () => {
		expect(exampleFromSchema({ type: ['null', 'integer'] })).toBe(0);
		expect(exampleFromSchema({ type: 'string', nullable: true })).toBe('text');
		expect(exampleFromSchema({ type: 'null' })).toBeNull();
	});
});

describe('exampleFromSchema – Tiefe und Randfälle', () => {
	function nested(levels: number): JsonSchema {
		let s: JsonSchema = { type: 'integer' };
		for (let i = 0; i < levels; i++) s = { type: 'object', properties: { child: s } };
		return s;
	}

	it('Standardtiefe 6: tiefer wird null', () => {
		// Tiefe 0..6 erlaubt: 6 Objektebenen + Integer auf Ebene 6
		expect(JSON.stringify(exampleFromSchema(nested(6)))).toContain('0');
		const deep = JSON.stringify(exampleFromSchema(nested(10)));
		expect(deep).toContain('null');
		expect(deep).not.toContain('0');
	});

	it('maxDepth-Option', () => {
		expect(exampleFromSchema(nested(2), { maxDepth: 1 })).toEqual({ child: { child: null } });
		expect(exampleFromSchema(nested(1), { maxDepth: 0 })).toEqual({ child: null });
		expect(
			exampleFromSchema({ type: 'array', items: { type: 'string' } }, { maxDepth: 0 })
		).toBeNull();
	});

	it('echter Zyklus wirft nicht', () => {
		const node: JsonSchema = { type: 'object', properties: {} };
		node.properties!.self = node;
		expect(() => exampleFromSchema(node)).not.toThrow();
		expect(exampleJson(node)).toContain('null');
	});

	it('leere und ungültige Schemas', () => {
		expect(exampleFromSchema({})).toBeNull();
		expect(exampleFromSchema(null)).toBeUndefined();
		expect(exampleFromSchema(undefined)).toBeUndefined();
		expect(exampleFromSchema('x' as unknown as JsonSchema)).toBeNull();
		expect(exampleFromSchema({ type: 'unbekannt' })).toBeNull();
		expect(
			exampleFromSchema({ type: 'object', properties: { a: 5 as unknown as JsonSchema } })
		).toEqual({ a: null });
	});
});

describe('exampleJson', () => {
	it('eingerücktes JSON bzw. leer', () => {
		expect(exampleJson({ type: 'object', properties: { a: { type: 'integer' } } })).toBe(
			'{\n  "a": 0\n}'
		);
		expect(exampleJson(null)).toBe('');
		expect(exampleJson(undefined)).toBe('');
		expect(exampleJson({})).toBe('null');
	});
});
