import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { getEndpointSchemas, resetSchemaCacheForTests } from '$lib/server/core/api/catalog/schemas';
import {
	defineEndpoint,
	registerCoreEndpoints,
	resetCoreEndpointsForTests
} from '$lib/server/core/api/registry';

const Item = z.object({ id: z.string(), name: z.string(), count: z.number().int().optional() });

function registerTestEndpoints(): void {
	registerCoreEndpoints([
		defineEndpoint({
			method: 'GET',
			path: '/x/:id',
			summary: 'Eintrag lesen',
			permission: 'core.x.view',
			params: z.object({ id: z.string().uuid() }),
			query: z.object({
				limit: z.coerce.number().int().min(1).max(100).optional(),
				search: z.string()
			}),
			response: Item,
			handler: () => null
		}),
		defineEndpoint({
			method: 'POST',
			path: '/x',
			summary: 'Eintrag anlegen',
			permission: 'core.x.edit',
			body: z.object({ name: z.string().min(1), tags: z.array(z.string()).optional() }),
			handler: () => null
		})
	]);
}

describe('API-Katalog: Schemas', () => {
	beforeEach(() => {
		resetCoreEndpointsForTests();
		resetSchemaCacheForTests();
		registerTestEndpoints();
	});
	afterEach(() => {
		resetCoreEndpointsForTests();
		resetSchemaCacheForTests();
	});

	it('liefert Pfad- und Query-Parameter als Objekt-Schema', () => {
		const s = getEndpointSchemas('GET', '/x/:id');
		expect(s.params?.type).toBe('object');
		expect(s.params?.required).toEqual(['id']);
		expect(s.params?.properties?.id?.type).toBe('string');
		expect(s.query?.type).toBe('object');
		expect(s.query?.required).toEqual(['search']);
		expect(s.query?.properties?.limit?.type).toBe('integer');
		expect(s.query?.properties?.search?.type).toBe('string');
		expect(s.body).toBeNull();
	});

	it('liefert die data-Nutzlast der Antwort ohne Hülle', () => {
		const s = getEndpointSchemas('get', '/x/:id');
		expect(s.response?.type).toBe('object');
		expect(s.response?.required).toEqual(expect.arrayContaining(['id', 'name']));
		expect(s.response?.required).not.toContain('count');
		expect(s.response?.properties?.data).toBeUndefined();
	});

	it('liefert den Body und null für undokumentierte Antworten', () => {
		const s = getEndpointSchemas('POST', '/x');
		expect(s.params).toBeNull();
		expect(s.query).toBeNull();
		expect(s.body?.type).toBe('object');
		expect(s.body?.required).toEqual(['name']);
		expect(s.body?.properties?.tags?.type).toBe('array');
		expect(s.response).toBeNull();
	});

	it('löst $ref auf und erkennt Zyklen', () => {
		type Node = { name: string; children: Node[] };
		const NodeSchema: z.ZodType<Node> = z
			.lazy(() => z.object({ name: z.string(), children: z.array(NodeSchema) }))
			.openapi('TestNode');
		registerCoreEndpoints([
			defineEndpoint({
				method: 'GET',
				path: '/tree',
				summary: 'Baum',
				permission: 'core.x.view',
				response: z.object({ root: Item.openapi('TestItem'), tree: NodeSchema }),
				handler: () => null
			})
		]);
		const s = getEndpointSchemas('GET', '/tree');
		expect(JSON.stringify(s.response)).not.toContain('$ref');
		expect(s.response?.properties?.root?.properties?.name?.type).toBe('string');
		const tree = s.response?.properties?.tree;
		expect(tree?.properties?.children?.items?.title).toBe('TestNode');
	});

	it('erkennt nachregistrierte Endpunkte (Cache-Schlüssel) und wirft nicht bei Unbekanntem', () => {
		expect(getEndpointSchemas('GET', '/y').body).toBeNull();
		registerCoreEndpoints([
			defineEndpoint({
				method: 'PUT',
				path: '/y',
				summary: 'Y',
				permission: 'core.x.edit',
				body: z.object({ flag: z.boolean() }),
				handler: () => null
			})
		]);
		expect(getEndpointSchemas('PUT', '/y').body?.properties?.flag?.type).toBe('boolean');
		expect(getEndpointSchemas('DELETE', '/x')).toEqual({
			params: null,
			query: null,
			body: null,
			response: null
		});
	});
});
