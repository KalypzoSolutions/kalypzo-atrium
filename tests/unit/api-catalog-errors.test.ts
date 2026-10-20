import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { deriveErrors } from '$lib/server/core/api/catalog/errors';
import type { RegisteredEndpoint } from '$lib/server/core/api/types';

function ep(
	partial: Partial<RegisteredEndpoint> & Pick<RegisteredEndpoint, 'method' | 'fullPath'>
): RegisteredEndpoint {
	return {
		path: partial.fullPath,
		summary: 'Test',
		permission: null,
		moduleId: 'core',
		segments: partial.fullPath.split('/').filter(Boolean),
		handler: () => null,
		...partial
	} as RegisteredEndpoint;
}

const keys = (list: { status: number; code: string }[]) => list.map((x) => `${x.status} ${x.code}`);

describe('deriveErrors', () => {
	it('öffentlicher GET ohne Schemas: nur Header/API-Key, Rate-Limit, 500', () => {
		const list = deriveErrors(ep({ method: 'GET', fullPath: '/health' }));
		expect(keys(list)).toEqual(['401 unauthenticated', '429 rate_limited', '500 internal_error']);
		expect(list[0]!.when).not.toContain('Keine Anmeldung');
		expect(list[0]!.when).toContain('; ');
		expect(list[2]!.when).toBe('Unerwarteter Serverfehler, Request-ID angeben');
	});

	it('PUT mit Recht, params und body', () => {
		const list = deriveErrors(
			ep({
				method: 'PUT',
				fullPath: '/users/:id',
				permission: 'core.users.manage',
				params: z.object({ id: z.string() }) as never,
				body: z.object({ name: z.string() }) as never
			})
		);
		expect(keys(list)).toEqual([
			'400 bad_request',
			'401 unauthenticated',
			'403 forbidden',
			'404 not_found',
			'413 payload_too_large',
			'422 validation_failed',
			'429 rate_limited',
			'500 internal_error'
		]);
		const byKey = Object.fromEntries(list.map((x) => [`${x.status} ${x.code}`, x.when]));
		expect(byKey['400 bad_request']).toContain('JSON');
		expect(byKey['401 unauthenticated']).toContain('Keine Anmeldung');
		expect(byKey['403 forbidden']).toContain('core.users.manage');
		expect(byKey['403 forbidden']).toContain('fremder Origin');
		expect(byKey['413 payload_too_large']).toContain('1 MB');
		expect(byKey['422 validation_failed']).toBe('Pfadparameter ungültig; Body ungültig');
		const statuses = list.map((x) => x.status);
		expect(statuses).toEqual([...statuses].sort((a, b) => a - b));
	});

	it('sessionOnly: 403 bei API-Key', () => {
		const list = deriveErrors(
			ep({
				method: 'GET',
				fullPath: '/api-keys',
				permission: null,
				authenticated: true,
				sessionOnly: true
			})
		);
		const forbidden = list.find((x) => x.status === 403);
		expect(forbidden?.when).toContain('API-Key');
		expect(forbidden?.when).not.toContain('Origin');
		expect(list.find((x) => x.status === 401)?.when).toContain('Keine Anmeldung');
	});

	it('Modul-Endpunkt: 404 module_disabled', () => {
		const list = deriveErrors(
			ep({
				method: 'GET',
				fullPath: '/modules/events/events',
				moduleId: 'events',
				permission: 'events.event.view',
				query: z.object({ q: z.string().optional() }) as never
			})
		);
		const md = list.find((x) => x.code === 'module_disabled');
		expect(md?.status).toBe(404);
		expect(md?.when).toContain('events');
		expect(list.some((x) => x.code === 'not_found')).toBe(false);
		expect(list.find((x) => x.code === 'validation_failed')?.when).toBe('Query-Parameter ungültig');
		expect(list.some((x) => x.code === 'bad_request')).toBe(false);
	});

	it('multipart: Content-Type, Formulardaten, Grenze in MB, kein JSON-Fehler', () => {
		const list = deriveErrors(
			ep({
				method: 'POST',
				fullPath: '/modules/actions/public/costs/:token',
				moduleId: 'actions',
				public: true,
				rateLimit: { limit: 10, windowSec: 60 },
				params: z.object({ token: z.string() }) as never,
				body: z.object({ name: z.string() }) as never,
				multipart: { maxBytes: 12 * 1024 * 1024, maxFiles: 3 }
			})
		);
		const bad = list.find((x) => x.code === 'bad_request')!;
		expect(bad.when).toContain('multipart/form-data');
		expect(bad.when).toContain('Content-Length');
		expect(bad.when).toContain('3 Datei');
		expect(bad.when).not.toContain('JSON');
		expect(list.find((x) => x.code === 'payload_too_large')?.when).toContain('12 MB');
		expect(list.find((x) => x.code === 'validation_failed')?.when).toBe(
			'Pfadparameter ungültig; Formularfelder ungültig'
		);
		expect(list.find((x) => x.code === 'unauthenticated')?.when).not.toContain('Keine Anmeldung');
		expect(keys(list).filter((k) => k === '400 bad_request')).toHaveLength(1);
	});

	it('öffentlicher JSON-POST verlangt application/json', () => {
		const list = deriveErrors(
			ep({
				method: 'POST',
				fullPath: '/modules/actions/public/register/:token',
				moduleId: 'actions',
				public: true,
				body: z.object({}) as never
			})
		);
		const bad = list.find((x) => x.code === 'bad_request')!;
		expect(bad.when).toContain('application/json');
		expect(bad.when).toContain('kein gültiges JSON');
	});
});
