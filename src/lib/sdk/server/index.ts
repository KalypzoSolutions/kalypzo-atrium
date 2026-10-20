/**
 * Server-SDK für Module. Einziger erlaubter Einstiegspunkt für serverseitigen Modulcode.
 *
 *   import { core, defineModule, defineEndpoint } from '$lib/sdk/server';
 */
import type { ModuleDefinition } from '$lib/server/core/modules/types';

export { core } from '$lib/server/core';
export type { Core } from '$lib/server/core';
export { defineEndpoint } from '$lib/server/core/api/registry';
export { CoreError, errors, isCoreError } from '$lib/server/core/errors';
export type {
	ModuleBackupHooks,
	ModuleBackupRehashHelpers,
	ModuleDefinition,
	ModuleJob,
	ModuleMigration,
	ModuleSearchProvider,
	ResetArea
} from '$lib/server/core/modules/types';
export type { Db, Tx } from '$lib/server/core/database/client';
export type { ApiEndpoint, ApiHandlerArgs } from '$lib/server/core/api/types';
export type * from '$lib/sdk/types';
export * from './sharing';
export type {
	ImageVariantSpec,
	ProcessedImage,
	ProcessedVariant,
	ProcessImageOptions
} from '$lib/server/core/images';

/** Typisierter Helfer für `src/lib/modules/<id>/module.ts` (Default-Export). */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
	return def;
}
