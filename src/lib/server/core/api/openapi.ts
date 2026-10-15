import {
	extendZodWithOpenApi,
	OpenApiGeneratorV31,
	OpenAPIRegistry
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { allEndpoints } from './registry';

extendZodWithOpenApi(z);

const ErrorSchema = z
	.object({
		error: z.object({
			code: z.string(),
			message: z.string(),
			details: z.unknown().optional(),
			requestId: z.string().optional()
		})
	})
	.openapi('ApiError');

function toOpenApiPath(path: string): string {
	return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

/** Erzeugt die OpenAPI-3.1-Spezifikation aus der Endpunkt-Registry. */
export function buildOpenApiDocument(version = '1.0.0') {
	const registry = new OpenAPIRegistry();
	registry.registerComponent('securitySchemes', 'bearerAuth', {
		type: 'http',
		scheme: 'bearer',
		description: 'API-Key (Prefix `epk_`) als Bearer-Token'
	});
	registry.registerComponent('securitySchemes', 'sessionCookie', {
		type: 'apiKey',
		in: 'cookie',
		name: 'better-auth.session_token'
	});

	for (const e of allEndpoints()) {
		const request: Record<string, unknown> = {};
		if (e.params) request.params = e.params as unknown as z.ZodObject;
		if (e.query) request.query = e.query as unknown as z.ZodObject;
		if (e.body) {
			request.body = {
				required: true,
				content: { 'application/json': { schema: e.body as unknown as z.ZodType } }
			};
		}
		const tags = e.moduleId === 'core' ? (e.tags ?? ['Core']) : [`Modul: ${e.moduleId}`];
		registry.registerPath({
			method: e.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete',
			path: toOpenApiPath(e.fullPath),
			summary: e.summary,
			description:
				(e.description ?? '') +
				(e.permission ? `\n\nErforderliche Berechtigung: \`${e.permission}\`` : ''),
			tags,
			security:
				e.permission === null && !e.authenticated
					? []
					: [{ bearerAuth: [] }, { sessionCookie: [] }],
			request,
			responses: {
				200: {
					description: 'Erfolg',
					content: {
						'application/json': {
							schema: z.object({ data: (e.response as z.ZodType | undefined) ?? z.unknown() })
						}
					}
				},
				400: {
					description: 'Ungueltige Anfrage',
					content: { 'application/json': { schema: ErrorSchema } }
				},
				401: {
					description: 'Nicht authentifiziert',
					content: { 'application/json': { schema: ErrorSchema } }
				},
				403: {
					description: 'Keine Berechtigung',
					content: { 'application/json': { schema: ErrorSchema } }
				},
				422: {
					description: 'Validierung fehlgeschlagen',
					content: { 'application/json': { schema: ErrorSchema } }
				},
				429: { description: 'Rate Limit', content: { 'application/json': { schema: ErrorSchema } } }
			}
		});
	}

	return new OpenApiGeneratorV31(registry.definitions).generateDocument({
		openapi: '3.1.0',
		info: {
			title: 'EP Intern API',
			version,
			description:
				'Versionierte REST-API des EP-Intern-Core. Authentifizierung per API-Key oder Session.'
		},
		servers: [{ url: '/api/v1' }]
	});
}
