/**
 * Core-Exporte für `$testing` (erzeugt beim Umzug der Modultests, Phase 4; danach von Hand pflegen).
 * Alle Funktionen, die Modultests vom Core brauchen – Modultests importieren sie nur über `$testing`.
 */
export { core } from '$lib/server/core';
export { setOpenAiClientFactoryForTests } from '$lib/server/core/ai';
export type { AiChatParams, AiClient } from '$lib/server/core/ai';
export { buildApiCatalog } from '$lib/server/core/api/catalog';
export { registerCoreApi } from '$lib/server/core/api/endpoints';
export { createApiKey } from '$lib/server/core/api/keys';
export { buildOpenApiDocument } from '$lib/server/core/api/openapi';
export { allEndpoints, matchEndpoint } from '$lib/server/core/api/registry';
export { apiLogPath, handleApiRequest } from '$lib/server/core/api/router';
export { listAudit } from '$lib/server/core/audit/service';
export { getAuth, resetAuthForTests } from '$lib/server/core/auth';
export { anonymousContext, contextForUser, systemContext } from '$lib/server/core/auth/context';
export { canManageUser } from '$lib/server/core/auth/manage-guard';
export { maskEmail } from '$lib/server/core/auth/mask-email';
export {
	AVATAR_MAX_BYTES,
	readAvatar,
	removeOwnAvatar,
	removeUserAvatar,
	requestEmailChange,
	setOwnAvatar,
	setUserAvatar,
	updateOwnName,
	verifyUserPassword
} from '$lib/server/core/auth/profile';
export {
	bootstrapAdmin,
	createUser,
	deleteUser,
	getUser,
	setUserActive,
	setUserRoles,
	updateUser,
	verifyUserEmail
} from '$lib/server/core/auth/users';
export { adminOnlyRestoreScopes } from '$lib/server/core/backup/access';
export { readArchive } from '$lib/server/core/backup/archive';
export {
	decryptEnvelope,
	deriveEnvelopeKey,
	readEnvelopeHeader
} from '$lib/server/core/backup/envelope';
export {
	setBackupClockForTests,
	startBackupExport,
	takeBackupDownload
} from '$lib/server/core/backup/export';
export { loadTableInfo, selfReference } from '$lib/server/core/backup/introspect';
export { collect } from '$lib/server/core/backup/io';
export {
	analyzeBackup,
	appendUpload,
	createUpload,
	executeRestore,
	waitForRestore
} from '$lib/server/core/backup/restore';
export { listBackupScopes, planTables } from '$lib/server/core/backup/scopes';
export {
	decodeRowSecrets,
	encodeRowSecrets,
	keyCheckValue,
	secretPurposeFor
} from '$lib/server/core/backup/secrets';
export {
	MERGE_CONFIRM_WORD,
	RESTORE_CONFIRM_WORD,
	isSecretMarker
} from '$lib/server/core/backup/types';
export type { TableInfo } from '$lib/server/core/backup/types';
export { decryptSecret, encryptSecret, isEncrypted, keyedHash } from '$lib/server/core/crypto';
export { collectDashboardFeed } from '$lib/server/core/dashboard/feed';
export {
	databaseAllowsParallelQueries,
	getDb,
	schema,
	setDb
} from '$lib/server/core/database/client';
export { withMigrationLock } from '$lib/server/core/database/migrate';
export { describeEmbeds, searchEmbeds } from '$lib/server/core/embeds/service';
export { env, resetEnvForTests } from '$lib/server/core/env';
export { isCoreError } from '$lib/server/core/errors';
export { dueBefore, pauseJobs, resumeJobs, runDueJobs, runJobNow } from '$lib/server/core/jobs';
export {
	formatSender,
	sendMail,
	setMailTransportForTests,
	smtpTransportOptions
} from '$lib/server/core/mail';
export type { MailTransport } from '$lib/server/core/mail';
export { registerModule, unregisterModule } from '$lib/server/core/modules/registry';
export {
	disableModule,
	enableModule,
	listModuleProblems,
	listModules,
	navigationFor,
	runModuleMigrations,
	syncModules
} from '$lib/server/core/modules/service';
export { splitSqlStatements } from '$lib/server/core/modules/split-sql';
export { invalidateModuleStateCache } from '$lib/server/core/modules/state';
export type { ModuleDefinition, ResetArea } from '$lib/server/core/modules/types';
export { validateModuleReferences } from '$lib/server/core/modules/validate';
export { navBadgeCounts } from '$lib/server/core/navigation/badges';
export { getMyPreferences, setMyPreference } from '$lib/server/core/notifications/service';
export {
	describeTemplates,
	mergePdfs,
	resolveTemplate,
	setPdfRendererForTests
} from '$lib/server/core/pdf';
export { brandIcon, brandLogo, brandingState, logoUrl } from '$lib/server/core/branding';
export { loadMailLayoutOptions, renderMailLayout } from '$lib/server/core/mail-layout';
export { renderPdfPage } from '$lib/server/core/pdf/raster';
export { renderBlocks } from '$lib/server/core/pdf/templates';
export { ADMIN_ROLE_ID, PRIVILEGED_PERMISSIONS } from '$lib/server/core/permissions/catalog';
export { adoptDefaultRole } from '$lib/server/core/permissions/default-roles';
export { listModuleRoleGrants, replaceModuleRoleGrants } from '$lib/server/core/permissions/grants';
export { createRole, deleteRole, updateRole } from '$lib/server/core/permissions/roles';
export {
	canGrantPermission,
	isAdministrator,
	listPermissions,
	syncPermissions
} from '$lib/server/core/permissions/service';
export { exportSubject, findPrivacySubjects } from '$lib/server/core/privacy/service';
export { reset, resetAllForTests } from '$lib/server/core/rate-limit';
export { searchEverything } from '$lib/server/core/search/service';
export {
	MAX_SETTINGS_PER_WRITE,
	getDefinition,
	getSetting,
	setSetting,
	setSettings
} from '$lib/server/core/settings/service';
export {
	allowedStartPages,
	loadUserPrefs,
	resolveStartPage,
	safeDensity,
	safeHexColor
} from '$lib/server/core/settings/user-prefs';
export { loadConfig, setFileRepoForTests } from '$lib/server/core/storage';
export { invalidateStorageConfigCache } from '$lib/server/core/storage/config-cache';
export {
	acquireMaintenanceLock,
	releaseMaintenanceLock
} from '$lib/server/core/system/maintenance';
export {
	RESET_CONFIRM_WORD,
	backupScopesForResetAreas,
	executeReset,
	exportResetData,
	listResetAreas,
	previewReset,
	setResetClockForTests,
	totpCode,
	verifyTotp
} from '$lib/server/core/system/reset';
