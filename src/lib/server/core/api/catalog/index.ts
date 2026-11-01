import type {
	ApiAccess,
	ApiCatalog,
	ApiCatalogEntry,
	ApiCatalogGroup,
	ApiMethod,
	ApiRateLimit
} from '$lib/api-docs/types';
import { intlLocale, localized } from '$lib/i18n';
import type { RequestContext } from '$lib/sdk/types';
import { allDefinitions } from '../../modules/registry';
import { enabledModuleIds } from '../../modules/state';
import { has } from '../../permissions/service';
import { allEndpoints } from '../registry';
import { endpointText } from '../text';
import type { RegisteredEndpoint } from '../types';
import { deriveErrors } from './errors';
import { ANON_RATE_LIMIT, DEFAULT_RATE_LIMIT } from './limits';
import { getEndpointSchemas } from './schemas';

const CORE_ID = 'core';
const CORE_TAG = 'api.tags.core';

function accessOf(e: RegisteredEndpoint): ApiAccess {
	if (e.permission !== null) return 'permission';
	return e.authenticated ? 'authenticated' : 'public';
}

function rateLimitOf(e: RegisteredEndpoint, access: ApiAccess): ApiRateLimit {
	if (e.rateLimit) {
		return { limit: e.rateLimit.limit, windowSec: e.rateLimit.windowSec, isDefault: false };
	}
	const fallback = access === 'public' ? ANON_RATE_LIMIT : DEFAULT_RATE_LIMIT;
	return { limit: fallback.limit, windowSec: fallback.windowSec, isDefault: true };
}

/** Erster Tag (bei Core-Endpunkten ein i18n-Schlüssel); dient als Gruppen-ID, Anzeige übersetzt */
function coreGroupTag(e: RegisteredEndpoint): string {
	return e.tags?.[0] ?? CORE_TAG;
}

/**
 * Katalog aller REST-Endpunkte (Core + registrierte Module) für die API-Übersicht.
 * Liefert nur serialisierbare Daten: keine Handler, keine Zod-Objekte, keine Geheimnisse.
 * Modulstatus kommt aus einer (kurz gecachten) Abfrage, nicht pro Endpunkt.
 */
export async function buildApiCatalog(ctx: RequestContext): Promise<ApiCatalog> {
	const endpoints = allEndpoints();
	const enabled = await enabledModuleIds();
	const moduleNames = new Map<string, string>();
	for (const def of allDefinitions())
		moduleNames.set(def.manifest.id, localized(def.manifest.name));

	const coreGroups: ApiCatalogGroup[] = [];
	const coreGroupIds = new Set<string>();
	const moduleGroups = new Map<string, ApiCatalogGroup>();

	const entries: ApiCatalogEntry[] = endpoints.map((e) => {
		const isCore = e.moduleId === CORE_ID;
		const moduleName = isCore
			? endpointText(CORE_TAG)
			: (moduleNames.get(e.moduleId) ?? e.moduleId);
		const access = accessOf(e);
		const permission = e.permission ?? null;

		let group: string;
		if (isCore) {
			const tag = coreGroupTag(e);
			group = `core:${tag}`;
			if (!coreGroupIds.has(group)) {
				coreGroupIds.add(group);
				coreGroups.push({ id: group, label: endpointText(tag) });
			}
		} else {
			group = `module:${e.moduleId}`;
			if (!moduleGroups.has(group)) moduleGroups.set(group, { id: group, label: moduleName });
		}

		const allowed = permission ? has(ctx, permission) : access !== 'authenticated' || !!ctx.userId;

		const schemas = getEndpointSchemas(e.method, e.fullPath, endpoints.length);

		return {
			id: `${e.method} ${e.fullPath}`,
			method: e.method as ApiMethod,
			path: `/api/v1${e.fullPath}`,
			moduleId: e.moduleId,
			moduleName,
			moduleEnabled: isCore || enabled.has(e.moduleId),
			group,
			summary: endpointText(e.summary),
			description: endpointText(e.description) ?? null,
			access,
			permission,
			sessionOnly: e.sessionOnly === true,
			allowed,
			rateLimit: rateLimitOf(e, access),
			multipart: e.multipart
				? { maxBytes: e.multipart.maxBytes, maxFiles: e.multipart.maxFiles ?? 1 }
				: null,
			params: schemas.params,
			query: schemas.query,
			body: schemas.body,
			response: schemas.response,
			successStatus: e.method === 'POST' ? 201 : 200,
			errors: deriveErrors(e)
		};
	});

	const sortedModuleGroups = [...moduleGroups.values()].sort((a, b) =>
		a.label.localeCompare(b.label, intlLocale())
	);

	return {
		generatedAt: new Date().toISOString(),
		entries,
		groups: [...coreGroups, ...sortedModuleGroups]
	};
}
