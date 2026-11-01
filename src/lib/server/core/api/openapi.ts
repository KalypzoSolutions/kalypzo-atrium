import { t } from '$lib/i18n';
import {
	extendZodWithOpenApi,
	OpenApiGeneratorV31,
	OpenAPIRegistry
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { allEndpoints } from './registry';
import { endpointText, translateDocumentTexts } from './text';

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
		description: t('api.openapi.bearer')
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
				content: {
					[e.multipart ? 'multipart/form-data' : 'application/json']: {
						schema: e.body as unknown as z.ZodType
					}
				}
			};
		}
		const tags =
			e.moduleId === 'core'
				? (e.tags ?? ['api.tags.core']).map((tag) => endpointText(tag))
				: [t('api.openapi.moduleTag', { id: e.moduleId })];
		registry.registerPath({
			method: e.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete',
			path: toOpenApiPath(e.fullPath),
			summary: endpointText(e.summary),
			description:
				(endpointText(e.description) ?? '') +
				(e.permission
					? `\n\n${t('api.openapi.requiredPermission', { permission: e.permission })}`
					: ''),
			tags,
			security:
				e.permission === null && !e.authenticated
					? []
					: [{ bearerAuth: [] }, { sessionCookie: [] }],
			request,
			responses: {
				200: {
					description: t('api.openapi.success'),
					content: {
						'application/json': {
							schema: z.object({ data: (e.response as z.ZodType | undefined) ?? z.unknown() })
						}
					}
				},
				400: {
					description: t('api.openapi.badRequest'),
					content: { 'application/json': { schema: ErrorSchema } }
				},
				401: {
					description: t('api.openapi.unauthenticated'),
					content: { 'application/json': { schema: ErrorSchema } }
				},
				403: {
					description: t('api.openapi.forbidden'),
					content: { 'application/json': { schema: ErrorSchema } }
				},
				422: {
					description: t('api.openapi.validation'),
					content: { 'application/json': { schema: ErrorSchema } }
				},
				429: { description: 'Rate Limit', content: { 'application/json': { schema: ErrorSchema } } }
			}
		});
	}

	const doc = new OpenApiGeneratorV31(registry.definitions).generateDocument({
		openapi: '3.1.0',
		info: {
			title: 'Kalypzo Atrium API',
			version,
			description: t('api.openapi.description')
		},
		servers: [{ url: '/api/v1' }]
	});
	// Schlüssel aus Zod-`describe` (Core-Schemas) in der Sprache des Requests
	return translateDocumentTexts(doc);
}
