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
export { describeError, errorSummary, isUniqueViolation } from '$lib/server/core/db-errors';
export type { ErrorDescription } from '$lib/server/core/db-errors';
export type {
	ModuleBackupHooks,
	ModuleBackupRehashHelpers,
	DataSubject,
	MemberDeletedInfo,
	ModuleSubjectExport,
	SubjectCandidate,
	ModuleDefinition,
	ModuleJob,
	ModuleMigration,
	ModuleNotifications,
	ModuleSearchProvider,
	ResetArea
} from '$lib/server/core/modules/types';
export type { Db, Tx } from '$lib/server/core/database/client';
export type {
	LegacyPreference,
	NotificationItem,
	NotificationSendResult
} from '$lib/server/core/notifications/service';
export type { AnyApiEndpoint, ApiEndpoint, ApiHandlerArgs } from '$lib/server/core/api/types';
export type * from '$lib/sdk/types';
export * from './sharing';
export * from './share-access';
export * from './db';
export * from './rate-limits';
export * from './best-effort';
export * from './file-response';
export * from './upload';
export * from './html';
export * from '$lib/sdk/dates';
export * from '$lib/sdk/csv';
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
