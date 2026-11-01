import { tl, t, type Locale } from '$lib/i18n';

/** Berechtigungen des Core. Schema: `modul.ressource.aktion`. Beschreibungen in `permissions.core.<recht>`. */
const CORE_PERMISSION_KEYS = [
	'core.users.view',
	'core.users.create',
	'core.users.edit',
	'core.users.delete',
	'core.roles.view',
	'core.roles.create',
	'core.roles.edit',
	'core.roles.delete',
	'core.roles.assign',
	'core.modules.view',
	'core.modules.manage',
	'core.modules.install',
	'core.jobs.manage',
	'core.settings.view',
	'core.settings.manage',
	'core.api.view',
	'core.api.manage',
	'core.storage.read',
	'core.storage.write',
	'core.storage.delete',
	'core.storage.manage',
	'core.pdf.generate',
	'core.pdf.manage',
	'core.ai.use',
	'core.ai.manage',
	'core.ai.view',
	'core.audit.view',
	'core.system.reset',
	'core.system.backup',
	'core.privacy.export'
] as const;

/** Beschreibung eines Core-Rechts (Standard: Sprache des Requests; in der Datenbank steht Deutsch) */
export function corePermissionDescription(key: string, locale?: Locale): string {
	return locale ? tl(locale, `permissions.core.${key}`) : t(`permissions.core.${key}`);
}

/** Core-Rechte → Beschreibung (beim Lesen in der Sprache des Requests übersetzt) */
export const CORE_PERMISSIONS: Record<string, string> = Object.defineProperties(
	{},
	Object.fromEntries(
		CORE_PERMISSION_KEYS.map((key) => [
			key,
			{ enumerable: true, get: () => corePermissionDescription(key) }
		])
	)
);

export const PERMISSION_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export const ADMIN_ROLE_ID = 'role_administrator';

/**
 * Admin-gleiche („privilegierte“) Rechte (#16): Sie führen faktisch zur Vollübernahme des Systems
 * (Datensicherung = alle Daten lesen und beliebige Daten einspielen; Zurücksetzen = Daten und Konten
 * löschen). Vergeben (Rolle anlegen/bearbeiten, Rolle zuweisen, API-Key-Scope, Ämter-Rollen) dürfen sie
 * nur Administrator*innen – siehe `isAdministrator`/`assertCanGrant` in `service.ts`.
 */
export const PRIVILEGED_PERMISSIONS: ReadonlySet<string> = new Set([
	'core.system.backup',
	'core.system.reset',
	// Liest sämtliche Daten einer Person, auch Gesundheitsdaten (#30)
	'core.privacy.export',
	// Fremder Modulcode läuft mit vollen Rechten im Server (Kalypzo Atrium)
	'core.modules.install'
]);
