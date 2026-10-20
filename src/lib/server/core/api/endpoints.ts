import { z } from 'zod';
import { listAudit } from '../audit/service';
import * as ai from '../ai';
import * as pdf from '../pdf';
import * as storage from '../storage';
import { createApiKey, listApiKeys, revokeApiKey } from './keys';
import {
	createUser,
	deleteUser,
	getUser,
	listUsers,
	setUserActive,
	setUserRoles,
	updateUser
} from '../auth/users';
import { disableModule, enableModule, listModules } from '../modules/service';
import { listJobs, runJobNow } from '../jobs';
import { createRole, deleteRole, listRoles, updateRole } from '../permissions/roles';
import { listPermissions } from '../permissions/service';
import { getPublicSettings, setSetting } from '../settings/service';
import { buildOpenApiDocument } from './openapi';
import { defineEndpoint, registerCoreEndpoints } from './registry';

const id = z.object({ id: z.string().min(1).max(64) });
const paging = z.object({
	search: z.string().max(100).optional(),
	limit: z.coerce.number().int().min(1).max(200).default(50),
	offset: z.coerce.number().int().min(0).default(0)
});
const password = z.string().min(12).max(128);

/** Ausdrückliche Freigabe: Nur diese Core-Funktionen sind über die externe API erreichbar. */
export function registerCoreApi(): void {
	registerCoreEndpoints([
		defineEndpoint({
			method: 'GET',
			path: '/health',
			summary: 'Health-Check',
			tags: ['System'],
			permission: null,
			handler: () => ({ status: 'ok' })
		}),
		defineEndpoint({
			method: 'GET',
			path: '/openapi.json',
			summary: 'OpenAPI-Spezifikation',
			tags: ['System'],
			permission: null,
			authenticated: true,
			handler: () =>
				new Response(JSON.stringify(buildOpenApiDocument()), {
					headers: { 'content-type': 'application/json' }
				})
		}),
		defineEndpoint({
			method: 'GET',
			path: '/me',
			summary: 'Eigene Identität und wirksame Berechtigungen',
			tags: ['System'],
			permission: null,
			authenticated: true,
			handler: ({ ctx }) => ({
				actor: ctx.actor,
				userId: ctx.userId,
				permissions: [...ctx.permissions].sort()
			})
		}),

		// Benutzer
		defineEndpoint({
			method: 'GET',
			path: '/users',
			summary: 'Benutzer auflisten',
			tags: ['Benutzer'],
			permission: 'core.users.view',
			query: paging,
			handler: ({ ctx, query }) => listUsers(ctx, query)
		}),
		defineEndpoint({
			method: 'GET',
			path: '/users/:id',
			summary: 'Benutzer abrufen',
			tags: ['Benutzer'],
			permission: 'core.users.view',
			params: id,
			handler: ({ ctx, params }) => getUser(ctx, params.id)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/users',
			summary: 'Benutzer anlegen',
			tags: ['Benutzer'],
			permission: 'core.users.create',
			body: z.object({
				name: z.string().trim().min(1).max(100),
				email: z.string().trim().email().max(255),
				password,
				roleIds: z.array(z.string()).max(50).optional()
			}),
			handler: async ({ ctx, body }) => ({ id: await createUser(ctx, body) })
		}),
		defineEndpoint({
			method: 'PATCH',
			path: '/users/:id',
			summary: 'Benutzer bearbeiten',
			tags: ['Benutzer'],
			permission: 'core.users.edit',
			params: id,
			body: z.object({
				name: z.string().trim().min(1).max(100).optional(),
				email: z.string().trim().email().max(255).optional(),
				active: z.boolean().optional(),
				roleIds: z.array(z.string()).max(50).optional()
			}),
			handler: async ({ ctx, params, body }) => {
				const { active, roleIds, ...rest } = body;
				if (Object.keys(rest).length) await updateUser(ctx, params.id, rest);
				if (active !== undefined) await setUserActive(ctx, params.id, active);
				if (roleIds) await setUserRoles(ctx, params.id, roleIds);
				return getUser(ctx, params.id);
			}
		}),
		defineEndpoint({
			method: 'DELETE',
			path: '/users/:id',
			summary: 'Benutzer löschen',
			tags: ['Benutzer'],
			permission: 'core.users.delete',
			params: id,
			handler: async ({ ctx, params }) => {
				await deleteUser(ctx, params.id);
				return null;
			}
		}),

		// Rollen & Berechtigungen
		defineEndpoint({
			method: 'GET',
			path: '/roles',
			summary: 'Rollen auflisten',
			tags: ['Rollen'],
			permission: 'core.roles.view',
			handler: ({ ctx }) => listRoles(ctx)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/roles',
			summary: 'Rolle anlegen',
			tags: ['Rollen'],
			permission: 'core.roles.create',
			body: z.object({
				name: z.string().trim().min(2).max(60),
				description: z.string().max(300).optional(),
				permissions: z.array(z.string()).max(500)
			}),
			handler: async ({ ctx, body }) => ({ id: await createRole(ctx, body) })
		}),
		defineEndpoint({
			method: 'PATCH',
			path: '/roles/:id',
			summary: 'Rolle bearbeiten',
			tags: ['Rollen'],
			permission: 'core.roles.edit',
			params: id,
			body: z.object({
				name: z.string().trim().min(2).max(60).optional(),
				description: z.string().max(300).optional(),
				permissions: z.array(z.string()).max(500).optional()
			}),
			handler: async ({ ctx, params, body }) => {
				await updateRole(ctx, params.id, body);
				return null;
			}
		}),
		defineEndpoint({
			method: 'DELETE',
			path: '/roles/:id',
			summary: 'Rolle löschen',
			tags: ['Rollen'],
			permission: 'core.roles.delete',
			params: id,
			handler: async ({ ctx, params }) => {
				await deleteRole(ctx, params.id);
				return null;
			}
		}),
		defineEndpoint({
			method: 'GET',
			path: '/permissions',
			summary: 'Registrierte Berechtigungen',
			tags: ['Rollen'],
			permission: 'core.roles.view',
			handler: () => listPermissions()
		}),

		// Module
		defineEndpoint({
			method: 'GET',
			path: '/modules',
			summary: 'Module auflisten',
			tags: ['Module'],
			permission: 'core.modules.view',
			handler: () => listModules()
		}),
		defineEndpoint({
			method: 'POST',
			path: '/modules/:id/enable',
			summary: 'Modul aktivieren',
			tags: ['Module'],
			permission: 'core.modules.manage',
			params: id,
			handler: async ({ ctx, params }) => {
				await enableModule(ctx, params.id);
				return null;
			}
		}),
		defineEndpoint({
			method: 'POST',
			path: '/modules/:id/disable',
			summary: 'Modul deaktivieren',
			tags: ['Module'],
			permission: 'core.modules.manage',
			params: id,
			handler: async ({ ctx, params }) => {
				await disableModule(ctx, params.id);
				return null;
			}
		}),

		// Hintergrundjobs
		defineEndpoint({
			method: 'GET',
			path: '/jobs',
			summary: 'Hintergrundjobs mit letztem Lauf',
			tags: ['Module'],
			permission: 'core.jobs.manage',
			handler: () => listJobs()
		}),
		defineEndpoint({
			method: 'POST',
			path: '/jobs/:key/run',
			summary: 'Hintergrundjob sofort ausführen',
			tags: ['Module'],
			permission: 'core.jobs.manage',
			params: z.object({ key: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/) }),
			handler: ({ ctx, params }) => runJobNow(ctx, params.key)
		}),

		// Einstellungen (Secrets werden nie ausgeliefert)
		defineEndpoint({
			method: 'GET',
			path: '/settings',
			summary: 'Systemeinstellungen (ohne Secret-Werte)',
			tags: ['Einstellungen'],
			permission: 'core.settings.view',
			query: z.object({ group: z.string().max(40).optional() }),
			handler: ({ query }) => getPublicSettings({ group: query.group, scope: 'global' })
		}),
		defineEndpoint({
			method: 'PUT',
			path: '/settings',
			summary: 'Systemeinstellungen setzen',
			tags: ['Einstellungen'],
			permission: 'core.settings.manage',
			body: z.object({ values: z.record(z.string(), z.unknown()) }),
			handler: async ({ ctx, body }) => {
				for (const [key, value] of Object.entries(body.values)) await setSetting(ctx, key, value);
				return null;
			}
		}),

		// API-Keys
		defineEndpoint({
			method: 'GET',
			path: '/api-keys',
			summary: 'API-Keys auflisten',
			tags: ['API-Keys'],
			permission: 'core.api.view',
			sessionOnly: true,
			handler: ({ ctx }) => listApiKeys(ctx)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/api-keys',
			summary: 'API-Key erzeugen (Klartext nur einmalig in der Antwort)',
			tags: ['API-Keys'],
			permission: 'core.api.manage',
			sessionOnly: true,
			body: z.object({
				name: z.string().trim().min(2).max(80),
				scopes: z.array(z.string()).min(1).max(200),
				expiresAt: z.coerce.date().nullish()
			}),
			handler: ({ ctx, body }) => createApiKey(ctx, body)
		}),
		defineEndpoint({
			method: 'DELETE',
			path: '/api-keys/:id',
			summary: 'API-Key widerrufen',
			tags: ['API-Keys'],
			permission: 'core.api.manage',
			sessionOnly: true,
			params: id,
			handler: async ({ ctx, params }) => {
				await revokeApiKey(ctx, params.id);
				return null;
			}
		}),

		// PDF
		defineEndpoint({
			method: 'POST',
			path: '/pdf',
			summary: 'PDF-Dokument erzeugen',
			tags: ['PDF'],
			permission: 'core.pdf.generate',
			body: z.object({
				template: z.string().max(40).optional(),
				title: z.string().trim().min(1).max(200),
				content: z
					.array(
						z.discriminatedUnion('type', [
							z.object({
								type: z.literal('heading'),
								text: z.string().max(500),
								level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional()
							}),
							z.object({ type: z.literal('paragraph'), text: z.string().max(20000) }),
							z.object({
								type: z.literal('list'),
								items: z.array(z.string().max(2000)).max(1000),
								ordered: z.boolean().optional()
							}),
							z.object({
								type: z.literal('table'),
								columns: z.array(z.string().max(200)).max(30),
								rows: z.array(z.array(z.string().max(2000)).max(30)).max(5000)
							}),
							z.object({ type: z.literal('pageBreak') })
						])
					)
					.max(2000),
				format: z.enum(['A3', 'A4', 'A5', 'Letter', 'Legal']).optional(),
				orientation: z
					.enum(['portrait', 'landscape'])
					.optional()
					.describe(
						'Seitenausrichtung. Wird bei Vorlagen mit festem Seitenlayout (Briefvorlagen wie stamm-brief, stamm-briefkopf, stamm-briefkopf-quer) ignoriert; dort bestimmt die Vorlage die Ausrichtung.'
					)
			}),
			rateLimit: { limit: 20, windowSec: 60 },
			handler: async ({ ctx, body }) => {
				const out = await pdf.generate(ctx, { ...body, module: 'core' });
				return new Response(out.buffer as BodyInit, {
					status: 200,
					headers: {
						'content-type': 'application/pdf',
						'content-disposition': `attachment; filename="${out.fileName}"`,
						'cache-control': 'no-store'
					}
				});
			}
		}),

		// KI
		defineEndpoint({
			method: 'POST',
			path: '/ai/generate',
			summary: 'Text mit dem zentral konfigurierten KI-Modell erzeugen',
			tags: ['KI'],
			permission: 'core.ai.use',
			body: z.object({
				prompt: z.string().min(1).max(100_000),
				system: z.string().max(10_000).optional(),
				model: z.string().max(100).optional(),
				temperature: z.number().min(0).max(2).optional(),
				maxOutputTokens: z.number().int().min(1).max(32_000).optional()
			}),
			rateLimit: { limit: 20, windowSec: 60 },
			handler: ({ ctx, body }) => ai.generate(ctx, { ...body, module: 'core' })
		}),
		defineEndpoint({
			method: 'GET',
			path: '/ai/usage',
			summary: 'KI-Verbrauch je Modul und Modell',
			tags: ['KI'],
			permission: 'core.ai.view',
			query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
			handler: ({ ctx, query }) => ai.usageSummary(ctx, query)
		}),

		// Storage (Berechtigung je Modul wird im Service geprüft: <modul>.storage.*)
		defineEndpoint({
			method: 'GET',
			path: '/storage/files',
			summary: 'Dateien und virtuelle Ordner eines Modulbereichs',
			tags: ['Storage'],
			permission: null,
			authenticated: true,
			query: z.object({
				module: z.string().min(2).max(40),
				prefix: z.string().max(300).optional()
			}),
			handler: ({ ctx, query }) => storage.list(ctx, query)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/storage/upload-url',
			summary: 'Signierte Upload-URL erzeugen',
			tags: ['Storage'],
			permission: null,
			authenticated: true,
			body: z.object({
				module: z.string().min(2).max(40),
				path: z.string().min(1).max(300),
				contentType: z.string().min(3).max(100),
				size: z.number().int().positive()
			}),
			handler: ({ ctx, body }) => storage.createSignedUploadUrl(ctx, body)
		}),
		defineEndpoint({
			method: 'POST',
			path: '/storage/files/:id/confirm',
			summary: 'Signierten Upload bestätigen',
			tags: ['Storage'],
			permission: null,
			authenticated: true,
			params: id,
			handler: ({ ctx, params }) => storage.confirmUpload(ctx, params.id)
		}),
		defineEndpoint({
			method: 'GET',
			path: '/storage/download-url',
			summary: 'Signierte Download-URL erzeugen',
			tags: ['Storage'],
			permission: null,
			authenticated: true,
			query: z.object({ module: z.string().min(2).max(40), path: z.string().min(1).max(300) }),
			handler: ({ ctx, query }) => storage.createSignedDownloadUrl(ctx, query)
		}),
		defineEndpoint({
			method: 'DELETE',
			path: '/storage/files',
			summary: 'Datei löschen',
			tags: ['Storage'],
			permission: null,
			authenticated: true,
			query: z.object({ module: z.string().min(2).max(40), path: z.string().min(1).max(300) }),
			handler: async ({ ctx, query }) => {
				await storage.remove(ctx, query);
				return null;
			}
		}),

		// Audit
		defineEndpoint({
			method: 'GET',
			path: '/audit-logs',
			summary: 'Audit-Logs',
			tags: ['Audit'],
			permission: 'core.audit.view',
			query: paging.extend({ action: z.string().max(100).optional() }),
			handler: ({ query }) => listAudit(query)
		})
	]);
}
