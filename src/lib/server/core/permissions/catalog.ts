/** Berechtigungen des Core. Schema: `modul.ressource.aktion`. */
export const CORE_PERMISSIONS: Record<string, string> = {
	'core.users.view': 'Benutzer ansehen',
	'core.users.create': 'Benutzer anlegen',
	'core.users.edit': 'Benutzer bearbeiten und deaktivieren',
	'core.users.delete': 'Benutzer löschen',
	'core.roles.view': 'Rollen und Berechtigungen ansehen',
	'core.roles.create': 'Rollen anlegen',
	'core.roles.edit': 'Rollen bearbeiten',
	'core.roles.delete': 'Rollen löschen',
	'core.roles.assign': 'Rollen an Benutzer zuweisen',
	'core.modules.view': 'Module ansehen',
	'core.modules.manage': 'Module aktivieren und deaktivieren',
	'core.jobs.manage': 'Hintergrundjobs ansehen und manuell auslösen',
	'core.settings.view': 'Systemeinstellungen ansehen',
	'core.settings.manage': 'Systemeinstellungen verwalten',
	'core.api.view': 'API-Keys ansehen',
	'core.api.manage': 'API-Keys verwalten',
	'core.storage.read': 'Dateien im Core-Speicherbereich lesen',
	'core.storage.write': 'Dateien im Core-Speicherbereich schreiben',
	'core.storage.delete': 'Dateien im Core-Speicherbereich löschen',
	'core.storage.manage': 'Storage konfigurieren und alle Speicherbereiche verwalten',
	'core.pdf.generate': 'PDF-Dokumente erzeugen',
	'core.pdf.manage': 'PDF-Vorlagen konfigurieren',
	'core.ai.use': 'KI-Dienst im Core-Kontext nutzen',
	'core.ai.manage': 'KI-Dienst konfigurieren',
	'core.ai.view': 'KI-Nutzung ansehen',
	'core.audit.view': 'Audit-Logs ansehen',
	'core.system.reset':
		'Datenbereiche zurücksetzen (Vorschau, Passwort, Pflicht-Export und Bestätigungswort)',
	'core.system.backup':
		'Datensicherung: Gesamt-Export (verschlüsselt, inkl. Zugangsdaten) und Import (Wiederherstellen/Zusammenführen)'
};

export const PERMISSION_PATTERN = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/;

export const ADMIN_ROLE_ID = 'role_administrator';
