/**
 * Beispielkatalog für die API-Übersicht (`/api-docs`): Referenz für UI und Tests.
 * Core-Gruppen „System“ und „Benutzer“, Modul `events` (aktiv), Modul `galleries` (inaktiv).
 */
import type {
	ApiCatalog,
	ApiCatalogEntry,
	ApiErrorInfo,
	JsonSchema
} from '../../src/lib/api-docs/types';

const DEFAULT_LIMIT = { limit: 120, windowSec: 60, isDefault: true } as const;

const ERR_UNAUTH: ApiErrorInfo = {
	status: 401,
	code: 'unauthenticated',
	when: 'Keine gültige Session bzw. kein gültiger API-Key'
};
const ERR_FORBIDDEN: ApiErrorInfo = {
	status: 403,
	code: 'forbidden',
	when: 'Die nötige Berechtigung fehlt'
};
const ERR_NOT_FOUND: ApiErrorInfo = {
	status: 404,
	code: 'not_found',
	when: 'Objekt nicht gefunden oder nicht sichtbar'
};
const ERR_VALIDATION: ApiErrorInfo = {
	status: 422,
	code: 'validation_failed',
	when: 'Eingaben ungültig (Details in `error.details`)'
};
const ERR_RATE: ApiErrorInfo = {
	status: 429,
	code: 'rate_limited',
	when: 'Zu viele Anfragen in kurzer Zeit'
};
const ERR_MODULE_DISABLED: ApiErrorInfo = {
	status: 404,
	code: 'module_disabled',
	when: 'Das Modul ist deaktiviert'
};

const idParams: JsonSchema = {
	type: 'object',
	properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
	required: ['id']
};

const pagingQuery: JsonSchema = {
	type: 'object',
	properties: {
		search: { type: 'string', maxLength: 100 },
		limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
		offset: { type: 'integer', minimum: 0, default: 0 }
	}
};

const userSchema: JsonSchema = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		name: { type: 'string' },
		email: { type: 'string', format: 'email' },
		active: { type: 'boolean' },
		roleIds: { type: 'array', items: { type: 'string' } },
		createdAt: { type: 'string', format: 'date-time' }
	},
	required: ['id', 'name', 'email', 'active', 'roleIds', 'createdAt']
};

const eventSchema: JsonSchema = {
	type: 'object',
	properties: {
		id: { type: 'string', format: 'uuid' },
		title: { type: 'string', maxLength: 200 },
		description: { type: ['string', 'null'] },
		location: { type: ['string', 'null'] },
		color: { type: 'string', pattern: '^#[0-9a-f]{6}$' },
		startDate: { type: 'string', format: 'date', examples: ['2026-11-07'] },
		startTime: { type: ['string', 'null'], pattern: '^\\d{2}:\\d{2}$' },
		endDate: { type: ['string', 'null'], format: 'date' },
		endTime: { type: ['string', 'null'] },
		tags: { type: 'array', items: { type: 'string' }, maxItems: 20 }
	},
	required: ['id', 'title', 'color', 'startDate', 'tags']
};

const eventBody: JsonSchema = {
	type: 'object',
	properties: {
		title: { type: 'string', minLength: 1, maxLength: 200 },
		description: { type: 'string', maxLength: 5000 },
		location: { type: 'string', maxLength: 200 },
		color: { type: 'string', pattern: '^#[0-9a-f]{6}$', default: '#2563eb' },
		startDate: { type: 'string', format: 'date' },
		startTime: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
		endDate: { type: 'string', format: 'date' },
		tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
		shares: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					type: { type: 'string', enum: ['everyone', 'group', 'member', 'role', 'user'] },
					id: { type: 'string' },
					level: { type: 'string', enum: ['read', 'edit'] }
				},
				required: ['type', 'id', 'level']
			}
		}
	},
	required: ['title', 'startDate'],
	additionalProperties: false
};

function entry(
	e: Omit<ApiCatalogEntry, 'id' | 'successStatus' | 'rateLimit' | 'multipart' | 'description'> &
		Partial<Pick<ApiCatalogEntry, 'rateLimit' | 'multipart' | 'description'>>
): ApiCatalogEntry {
	return {
		description: null,
		rateLimit: DEFAULT_LIMIT,
		multipart: null,
		...e,
		id: `${e.method} ${e.path}`,
		successStatus: e.method === 'POST' ? 201 : 200
	};
}

const core = { moduleId: 'core', moduleName: 'Core', moduleEnabled: true } as const;
const events = { moduleId: 'events', moduleName: 'Termine', moduleEnabled: true } as const;
const galleries = { moduleId: 'galleries', moduleName: 'Galerien', moduleEnabled: false } as const;

export const sampleCatalog: ApiCatalog = {
	generatedAt: '2026-10-18T09:30:00.000Z',
	groups: [
		{ id: 'System', label: 'System' },
		{ id: 'Benutzer', label: 'Benutzer' },
		{ id: 'module:events', label: 'Termine' },
		{ id: 'module:galleries', label: 'Galerien' }
	],
	entries: [
		entry({
			...core,
			method: 'GET',
			path: '/api/v1/health',
			group: 'System',
			summary: 'Health-Check',
			description: 'Liefert `ok`, solange der Server läuft. Ohne Anmeldung erreichbar.',
			access: 'public',
			permission: null,
			sessionOnly: false,
			allowed: true,
			params: null,
			query: null,
			body: null,
			response: {
				type: 'object',
				properties: { status: { type: 'string', const: 'ok' } },
				required: ['status']
			},
			errors: [ERR_RATE]
		}),
		entry({
			...core,
			method: 'GET',
			path: '/api/v1/me',
			group: 'System',
			summary: 'Eigene Identität und wirksame Berechtigungen',
			access: 'authenticated',
			permission: null,
			sessionOnly: false,
			allowed: true,
			params: null,
			query: null,
			body: null,
			response: {
				type: 'object',
				properties: {
					actor: {
						type: 'object',
						properties: {
							type: { type: 'string', enum: ['user', 'api_key', 'system'] },
							id: { type: 'string' },
							name: { type: 'string' }
						},
						required: ['type', 'id', 'name']
					},
					userId: { type: ['string', 'null'] },
					permissions: { type: 'array', items: { type: 'string' } }
				},
				required: ['actor', 'userId', 'permissions']
			},
			errors: [ERR_UNAUTH, ERR_RATE]
		}),
		entry({
			...core,
			method: 'POST',
			path: '/api/v1/api-keys',
			group: 'System',
			summary: 'API-Key anlegen',
			description: 'Der Klartext-Schlüssel wird nur einmal zurückgegeben. Nur mit Session möglich.',
			access: 'permission',
			permission: 'core.api.manage',
			sessionOnly: true,
			allowed: true,
			rateLimit: { limit: 10, windowSec: 300, isDefault: false },
			params: null,
			query: null,
			body: {
				type: 'object',
				properties: {
					name: { type: 'string', minLength: 1, maxLength: 100 },
					scopes: { type: 'array', items: { type: 'string' }, minItems: 1 },
					expiresAt: { type: 'string', format: 'date-time' }
				},
				required: ['name', 'scopes']
			},
			response: {
				type: 'object',
				properties: { id: { type: 'string' }, key: { type: 'string' } },
				required: ['id', 'key']
			},
			errors: [ERR_UNAUTH, ERR_FORBIDDEN, ERR_VALIDATION, ERR_RATE]
		}),
		entry({
			...core,
			method: 'GET',
			path: '/api/v1/users',
			group: 'Benutzer',
			summary: 'Benutzer auflisten',
			access: 'permission',
			permission: 'core.users.view',
			sessionOnly: false,
			allowed: true,
			params: null,
			query: pagingQuery,
			body: null,
			response: {
				type: 'object',
				properties: {
					items: { type: 'array', items: userSchema },
					total: { type: 'integer', minimum: 0 }
				},
				required: ['items', 'total']
			},
			errors: [ERR_UNAUTH, ERR_FORBIDDEN, ERR_VALIDATION, ERR_RATE]
		}),
		entry({
			...core,
			method: 'POST',
			path: '/api/v1/users',
			group: 'Benutzer',
			summary: 'Benutzer anlegen',
			access: 'permission',
			permission: 'core.users.create',
			sessionOnly: false,
			allowed: true,
			params: null,
			query: null,
			body: {
				type: 'object',
				properties: {
					name: { type: 'string', minLength: 1, maxLength: 100 },
					email: { type: 'string', format: 'email', maxLength: 255 },
					password: { type: 'string', minLength: 12, maxLength: 128 },
					roleIds: { type: 'array', items: { type: 'string' }, maxItems: 50 }
				},
				required: ['name', 'email', 'password']
			},
			response: {
				type: 'object',
				properties: { id: { type: 'string' } },
				required: ['id']
			},
			errors: [
				ERR_UNAUTH,
				ERR_FORBIDDEN,
				ERR_VALIDATION,
				{ status: 409, code: 'conflict', when: 'Die E-Mail-Adresse ist bereits vergeben' },
				ERR_RATE
			]
		}),
		entry({
			...core,
			method: 'DELETE',
			path: '/api/v1/users/:id',
			group: 'Benutzer',
			summary: 'Benutzer löschen',
			access: 'permission',
			permission: 'core.users.delete',
			sessionOnly: false,
			allowed: false,
			params: idParams,
			query: null,
			body: null,
			response: null,
			errors: [ERR_UNAUTH, ERR_FORBIDDEN, ERR_NOT_FOUND, ERR_RATE]
		}),
		entry({
			...core,
			method: 'GET',
			path: '/api/v1/users/:id',
			group: 'Benutzer',
			summary: 'Benutzer abrufen',
			access: 'permission',
			permission: 'core.users.view',
			sessionOnly: false,
			allowed: true,
			params: idParams,
			query: null,
			body: null,
			response: userSchema,
			errors: [ERR_UNAUTH, ERR_FORBIDDEN, ERR_NOT_FOUND, ERR_RATE]
		}),
		entry({
			...events,
			method: 'GET',
			path: '/api/v1/modules/events/events',
			group: 'module:events',
			summary: 'Termine auflisten',
			description: 'Nur sichtbare Termine (Eigentümer*in, Freigabe oder `events.event.view-all`).',
			access: 'permission',
			permission: 'events.event.view',
			sessionOnly: false,
			allowed: true,
			params: null,
			query: {
				type: 'object',
				properties: {
					from: { type: 'string', format: 'date' },
					to: { type: 'string', format: 'date' },
					tag: { type: 'string' },
					groupId: { type: 'string' }
				}
			},
			body: null,
			response: { type: 'array', items: eventSchema },
			errors: [ERR_UNAUTH, ERR_FORBIDDEN, ERR_VALIDATION, ERR_MODULE_DISABLED, ERR_RATE]
		}),
		entry({
			...events,
			method: 'PUT',
			path: '/api/v1/modules/events/events/:id',
			group: 'module:events',
			summary: 'Termin bearbeiten',
			access: 'permission',
			permission: 'events.event.edit',
			sessionOnly: false,
			allowed: true,
			params: idParams,
			query: null,
			body: eventBody,
			response: eventSchema,
			errors: [
				ERR_UNAUTH,
				ERR_FORBIDDEN,
				ERR_NOT_FOUND,
				ERR_VALIDATION,
				ERR_MODULE_DISABLED,
				ERR_RATE
			]
		}),
		entry({
			...events,
			method: 'GET',
			path: '/api/v1/modules/events/website/events',
			group: 'module:events',
			summary: 'Öffentliche Termine für die Website',
			description: 'Für den API-Key der Stammeswebsite; liefert nur öffentliche Felder.',
			access: 'permission',
			permission: 'events.website.read',
			sessionOnly: false,
			allowed: false,
			params: null,
			query: {
				type: 'object',
				properties: {
					from: { type: 'string', format: 'date' },
					limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 }
				}
			},
			body: null,
			response: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						title: { type: 'string' },
						startDate: { type: 'string', format: 'date' },
						recurring: { type: 'boolean' },
						occurrenceDate: { type: ['string', 'null'], format: 'date' }
					},
					required: ['title', 'startDate', 'recurring']
				}
			},
			errors: [ERR_UNAUTH, ERR_FORBIDDEN, ERR_MODULE_DISABLED, ERR_RATE]
		}),
		entry({
			...galleries,
			method: 'GET',
			path: '/api/v1/modules/galleries/galleries',
			group: 'module:galleries',
			summary: 'Galerien auflisten',
			access: 'permission',
			permission: 'galleries.gallery.view',
			sessionOnly: false,
			allowed: true,
			params: null,
			query: pagingQuery,
			body: null,
			response: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string', format: 'uuid' },
						title: { type: 'string' },
						visibility: { type: 'string', enum: ['public', 'private'] },
						imageCount: { type: 'integer', minimum: 0 }
					},
					required: ['id', 'title', 'visibility', 'imageCount']
				}
			},
			errors: [ERR_UNAUTH, ERR_FORBIDDEN, ERR_MODULE_DISABLED, ERR_RATE]
		}),
		entry({
			...galleries,
			method: 'POST',
			path: '/api/v1/modules/galleries/public/upload/:token',
			group: 'module:galleries',
			summary: 'Bilder über Upload-Link einreichen',
			description: 'Öffentlicher Upload per `multipart/form-data` (Feld `files`, Textfeld `name`).',
			access: 'public',
			permission: null,
			sessionOnly: false,
			allowed: true,
			rateLimit: { limit: 5, windowSec: 600, isDefault: false },
			multipart: { maxBytes: 12 * 1024 * 1024, maxFiles: 10 },
			params: {
				type: 'object',
				properties: { token: { type: 'string', minLength: 32, maxLength: 64 } },
				required: ['token']
			},
			query: null,
			body: {
				type: 'object',
				properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
				required: ['name']
			},
			response: {
				type: 'object',
				properties: { accepted: { type: 'integer', minimum: 0 } },
				required: ['accepted']
			},
			errors: [
				ERR_NOT_FOUND,
				{
					status: 400,
					code: 'bad_request',
					when: 'Kein `multipart/form-data` oder doppelte Felder'
				},
				{ status: 413, code: 'too_large', when: 'Dateien größer als erlaubt' },
				ERR_VALIDATION,
				ERR_MODULE_DISABLED,
				ERR_RATE
			]
		})
	]
};
