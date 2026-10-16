/**
 * Server-SDK fuer Module. Einziger erlaubter Einstiegspunkt fuer serverseitigen Modulcode.
 *
 *   import { core, defineModule, defineEndpoint } from '$lib/sdk/server';
 */
import type { ModuleDefinition } from '$lib/server/core/modules/types';

export { core } from '$lib/server/core';
export type { Core } from '$lib/server/core';
export { defineEndpoint } from '$lib/server/core/api/registry';
export { CoreError, errors, isCoreError } from '$lib/server/core/errors';
export type { ModuleDefinition, ModuleJob, ModuleMigration } from '$lib/server/core/modules/types';
export type { Db, Tx } from '$lib/server/core/database/client';
export type { ApiEndpoint, ApiHandlerArgs } from '$lib/server/core/api/types';
export type * from '$lib/sdk/types';

/** Typisierter Helfer fuer `src/lib/modules/<id>/module.ts` (Default-Export). */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
	return def;
}
