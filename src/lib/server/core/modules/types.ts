import type { ModuleManifest, ModuleSettingDefinition, RequestContext } from '$lib/sdk/types';
import type { ApiEndpoint } from '../api/types';

export interface ModuleMigration {
	name: string;
	sql: string;
}

/**
 * Serverseitige Moduldefinition. Wird in `src/lib/modules/<id>/module.ts` per
 * `defineModule(...)` exportiert und zur Build-Zeit registriert.
 */
export interface ModuleDefinition {
	manifest: ModuleManifest;
	settings?: ModuleSettingDefinition[];
	/* eslint-disable @typescript-eslint/no-explicit-any */
	endpoints?: ApiEndpoint<any, any, any>[];
	/* eslint-enable @typescript-eslint/no-explicit-any */
	/** SQL-Migrationen, laufen im PostgreSQL-Schema `mod_<id>` */
	migrations?: ModuleMigration[];
	/**
	 * Dienste, die dieses Modul abhaengigen Modulen anbietet (Funktionen; Typvertrag in `contract.ts`
	 * des Moduls). Abruf nur ueber `core.modules.use(providerId, callerId)`.
	 */
	provides?: Record<string, unknown>;
	onEnable?: (ctx: RequestContext) => Promise<void>;
	onDisable?: (ctx: RequestContext) => Promise<void>;
}

export const MODULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;
export const RESERVED_MODULE_IDS = new Set(['core', 'api', 'auth', 'admin', 'system']);

export function moduleSchemaName(moduleId: string): string {
	return `mod_${moduleId.replace(/-/g, '_')}`;
}
