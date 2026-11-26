/**
 * Server-SDK für Module. Einziger erlaubter Einstiegspunkt für serverseitigen Modulcode.
 *
 *   import { core, defineModule, defineEndpoint } from '$lib/sdk/server';
 */
import type { ModuleDefinition } from '$lib/server/core/modules/types';

export * from '$lib/sdk/csv';
export * from '$lib/sdk/dates';
export type * from '$lib/sdk/types';
export type { Core } from '$lib/server/core';
export { core } from '$lib/server/core';
export { defineEndpoint } from '$lib/server/core/api/registry';
export type { AnyApiEndpoint, ApiEndpoint, ApiHandlerArgs } from '$lib/server/core/api/types';
export type { Db, Tx } from '$lib/server/core/database/client';
export type { ErrorDescription } from '$lib/server/core/db-errors';
export { describeError, errorSummary, isUniqueViolation } from '$lib/server/core/db-errors';
export { CoreError, errors, isCoreError } from '$lib/server/core/errors';
export type {
	ImageVariantSpec,
	ProcessedImage,
	ProcessedVariant,
	ProcessImageOptions
} from '$lib/server/core/images';
export type { MailBranding } from '$lib/server/core/mail-layout';
export type {
	DataSubject,
	MemberDeletedInfo,
	ModuleAssist,
	ModuleAssistContext,
	ModuleAssistPurpose,
	ModuleBackupHooks,
	ModuleBackupRehashHelpers,
	ModuleDashboardSource,
	ModuleDashboardSources,
	ModuleDefinition,
	ModuleEmbedProvider,
	ModuleJob,
	ModuleMigration,
	ModuleNotifications,
	ModuleSearchProvider,
	ModuleSubjectExport,
	ResetArea,
	SubjectCandidate
} from '$lib/server/core/modules/types';
export type {
	LegacyPreference,
	NotificationItem,
	NotificationSendResult
} from '$lib/server/core/notifications/service';
export { CARLITO_STACK } from '$lib/server/core/pdf/fonts';
export type {
	LetterGeometry,
	LetterheadSpec,
	LetterOrientation,
	LetterTemplateOptions
} from '$lib/server/core/pdf/parts/letter';
export {
	addressField,
	createLetterTemplate,
	foldMarks,
	GEOMETRY as LETTER_GEOMETRY,
	GEOMETRY_LANDSCAPE as LETTER_GEOMETRY_LANDSCAPE,
	letterGeometry,
	neutralFooterLines
} from '$lib/server/core/pdf/parts/letter';
export type { RenderedPdfPage, RenderPdfPageOptions } from '$lib/server/core/pdf/raster';
export type {
	PdfLayoutData,
	PdfTemplate,
	PdfTemplateInput,
	PdfTemplatePart
} from '$lib/server/core/pdf/templates';
export { escapeHtml } from '$lib/server/core/pdf/templates';
export * from './best-effort';
export * from './db';
export * from './file-response';
export * from './html';
export * from './live-hub';
export { manifestFromPackage } from './module-package';
export * from './rate-limits';
export * from './share-access';
export * from './sharing';
export * from './upload';

/** Typisierter Helfer für `modules/<id>/module.ts` (Default-Export). */
export function defineModule(def: ModuleDefinition): ModuleDefinition {
	return def;
}
