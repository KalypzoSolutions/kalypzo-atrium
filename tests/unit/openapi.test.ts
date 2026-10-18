import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { registerCoreApi } from '$lib/server/core/api/endpoints';
import { buildOpenApiDocument } from '$lib/server/core/api/openapi';

describe('OpenAPI', () => {
	it('erzeugt eine gültige 3.1-Spezifikation (WRITE_OPENAPI=1 schreibt docs/openapi.json)', () => {
		registerCoreApi();
		const doc = buildOpenApiDocument();
		expect(doc.openapi).toBe('3.1.0');
		expect(Object.keys(doc.paths ?? {})).toEqual(
			expect.arrayContaining(['/users', '/users/{id}', '/roles', '/api-keys', '/health'])
		);
		if (process.env.WRITE_OPENAPI) {
			writeFileSync('docs/openapi.json', JSON.stringify(doc, null, 2) + '\n');
		}
	});
});
