/**
 * Verwaltungsbereich (`/admin`): Abschnitte, Seiten, Reiter und Suchbegriffe – EINE Quelle für Seitenleiste,
 * Übersicht, Befehlspalette und Reiterleisten. Rein und client-tauglich.
 */
import type { ModuleNavEntry } from './nav';

export type AdminSectionId = 'people' | 'settings' | 'modules' | 'api' | 'maintenance';

export interface AdminSection {
	id: AdminSectionId;
	label: string;
	icon: string;
	description: string;
}

export interface AdminEntry {
	/** Eindeutig, z. B. `settings.mail` */
	id: string;
	section: AdminSectionId;
	label: string;
	description: string;
	href: string;
	icon: string;
	/** Ohne Angabe: für alle angemeldeten Benutzer*innen */
	permission?: string;
	/** Alternativ: eines dieser Rechte genügt */
	anyPermission?: readonly string[];
	/** Suchbegriffe (Felder, Synonyme) */
	keywords: readonly string[];
	/** Seite in der Seitenleiste (sonst nur Reiter/Suchtreffer) */
	nav?: boolean;
	/** Reiter innerhalb einer Seite: ID des übergeordneten Eintrags (z. B. `settings`) */
	parent?: string;
}

export const ADMIN_HOME = { label: 'Übersicht', href: '/admin', icon: 'layout-grid' } as const;

export const ADMIN_SECTIONS: readonly AdminSection[] = [
	{
		id: 'people',
		label: 'Personen & Rechte',
		icon: 'users',
		description: 'Benutzerkonten, Rollen und was sie dürfen.'
	},
	{
		id: 'settings',
		label: 'Einstellungen',
		icon: 'settings',
		description: 'Organisation, Design, E-Mail, Speicher, KI, PDF und Modul-Einstellungen.'
	},
	{
		id: 'modules',
		label: 'Module',
		icon: 'puzzle',
		description: 'Module aktivieren und ihre eigenen Einstellungsseiten.'
	},
	{
		id: 'api',
		label: 'Schnittstellen',
		icon: 'terminal',
		description: 'API-Keys für externe Dienste und die Übersicht aller Endpunkte.'
	},
	{
		id: 'maintenance',
		label: 'Protokoll & Wartung',
		icon: 'scroll-text',
		description: 'Audit-Log, Datensicherung und Zurücksetzen von Daten.'
	}
];

const SETTINGS_ANY = [
	'core.settings.view',
	'core.ai.manage',
	'core.ai.view',
	'core.storage.manage',
	'core.pdf.manage'
];

export const ADMIN_ENTRIES: readonly AdminEntry[] = [
	// Personen & Rechte
	{
		id: 'users',
		section: 'people',
		label: 'Benutzer',
		description: 'Konten anlegen, sperren, Rollen zuweisen.',
		href: '/admin/users',
		icon: 'users',
		permission: 'core.users.view',
		keywords: ['Konto', 'Konten', 'Benutzer*innen', 'Passwort', 'deaktivieren', 'E-Mail-Adresse'],
		nav: true
	},
	{
		id: 'roles',
		section: 'people',
		label: 'Rollen',
		description: 'Rollen und ihre Rechte bearbeiten.',
		href: '/admin/roles',
		icon: 'shield',
		permission: 'core.roles.view',
		keywords: ['Rolle', 'Administrator', 'Mitglied', 'Rechte vergeben'],
		nav: true
	},
	{
		id: 'roles.permissions',
		section: 'people',
		label: 'Berechtigungen',
		description: 'Alle Rechte mit Modul und zugehörigen Rollen.',
		href: '/admin/roles/permissions',
		icon: 'key-round',
		permission: 'core.roles.view',
		keywords: ['Recht', 'Rechte', 'Permission', 'Zugriff'],
		parent: 'roles'
	},
	// Einstellungen
	{
		id: 'settings',
		section: 'settings',
		label: 'Einstellungen',
		description: 'Alle Systemeinstellungen an einem Ort.',
		href: '/admin/settings',
		icon: 'settings',
		anyPermission: SETTINGS_ANY,
		keywords: ['Konfiguration', 'System'],
		nav: true
	},
	{
		id: 'settings.general',
		section: 'settings',
		label: 'Allgemein',
		description: 'Systemname, Name, Anschrift und Kontakt der Organisation.',
		href: '/admin/settings/general',
		icon: 'settings',
		permission: 'core.settings.view',
		keywords: ['Systemname', 'Organisation', 'Stamm', 'Anschrift', 'Adresse', 'Telefon', 'Kontakt'],
		parent: 'settings'
	},
	{
		id: 'settings.design',
		section: 'settings',
		label: 'Design',
		description: 'Logo und Akzentfarbe.',
		href: '/admin/settings/design',
		icon: 'sparkles',
		permission: 'core.settings.view',
		keywords: ['Logo', 'Akzentfarbe', 'Farbe', 'Erscheinungsbild', 'Branding'],
		parent: 'settings'
	},
	{
		id: 'settings.mail',
		section: 'settings',
		label: 'E-Mail-Versand',
		description: 'SMTP-Server, Zugangsdaten, Absender und Test-E-Mail.',
		href: '/admin/settings/mail',
		icon: 'mail',
		permission: 'core.settings.view',
		keywords: ['SMTP', 'Mailserver', 'Absender', 'Port', 'TLS', 'Test-E-Mail', 'Passwort'],
		parent: 'settings'
	},
	{
		id: 'settings.mail-layout',
		section: 'settings',
		label: 'E-Mail-Layout',
		description: 'Aussehen ausgehender E-Mails mit Vorschau.',
		href: '/admin/settings/mail-layout',
		icon: 'mail',
		permission: 'core.settings.view',
		keywords: ['Signatur', 'Fußzeile', 'Wappen', 'Vorschau', 'Mail-Vorlage'],
		parent: 'settings'
	},
	{
		id: 'settings.storage',
		section: 'settings',
		label: 'Speicher',
		description: 'S3-Speicher für Dateien, Belege und Bilder.',
		href: '/admin/settings/storage',
		icon: 'hard-drive',
		permission: 'core.storage.manage',
		keywords: ['Storage', 'S3', 'MinIO', 'Bucket', 'Dateien', 'Upload', 'Endpoint'],
		parent: 'settings'
	},
	{
		id: 'settings.ai',
		section: 'settings',
		label: 'KI',
		description: 'KI-Anbieter, Modell, Limits und Nutzung.',
		href: '/admin/settings/ai',
		icon: 'sparkles',
		anyPermission: ['core.ai.view', 'core.ai.manage'],
		keywords: ['Künstliche Intelligenz', 'Claude', 'Modell', 'API-Schlüssel', 'Kosten', 'Budget'],
		parent: 'settings'
	},
	{
		id: 'settings.pdf',
		section: 'settings',
		label: 'PDF',
		description: 'PDF-Einstellungen, Briefvorlagen mit Vorschau, Test-PDF.',
		href: '/admin/settings/pdf',
		icon: 'file-text',
		permission: 'core.pdf.manage',
		keywords: ['Briefkopf', 'Vorlage', 'Brief', 'Dokument', 'Papierformat'],
		parent: 'settings'
	},
	{
		id: 'settings.modules',
		section: 'settings',
		label: 'Module',
		description: 'Einstellungen der aktiven Module (z. B. Bankdaten, Stammesname).',
		href: '/admin/settings/modules',
		icon: 'puzzle',
		permission: 'core.settings.view',
		keywords: [
			'Modul-Einstellungen',
			'Bankdaten',
			'IBAN',
			'BIC',
			'Kontoinhaber',
			'Stammesname',
			'Adresssuche'
		],
		parent: 'settings'
	},
	// Module
	{
		id: 'modules',
		section: 'modules',
		label: 'Module',
		description: 'Module aktivieren und deaktivieren.',
		href: '/admin/modules',
		icon: 'puzzle',
		permission: 'core.modules.view',
		keywords: ['aktivieren', 'deaktivieren', 'Erweiterung', 'Version'],
		nav: true
	},
	// Schnittstellen
	{
		id: 'api',
		section: 'api',
		label: 'API-Keys',
		description: 'Schlüssel für externe Dienste (z. B. Stammeswebsite).',
		href: '/admin/api',
		icon: 'key-round',
		permission: 'core.api.view',
		keywords: ['API-Schlüssel', 'Token', 'Scope', 'Website', 'Zugang'],
		nav: true
	},
	{
		id: 'api.docs',
		section: 'api',
		label: 'API-Übersicht',
		description: 'Alle REST-Endpunkte mit Rechten, Schemas und Konsole.',
		href: '/admin/api/docs',
		icon: 'terminal',
		permission: 'core.api.view',
		keywords: ['REST', 'Endpunkte', 'Dokumentation', 'OpenAPI', 'Konsole'],
		parent: 'api'
	},
	// Protokoll & Wartung
	{
		id: 'audit',
		section: 'maintenance',
		label: 'Audit-Log',
		description: 'Wer hat wann was geändert.',
		href: '/admin/audit',
		icon: 'scroll-text',
		permission: 'core.audit.view',
		keywords: ['Protokoll', 'Verlauf', 'Logins', 'Änderungen', 'Log'],
		nav: true
	},
	{
		id: 'reset',
		section: 'maintenance',
		label: 'Zurücksetzen',
		description: 'Daten einzelner Bereiche oder des ganzen Systems löschen (mit Sicherung).',
		href: '/admin/reset',
		icon: 'rotate-ccw',
		permission: 'core.system.reset',
		keywords: ['Reset', 'Löschen'],
		nav: true
	},
	{
		id: 'backup',
		section: 'maintenance',
		label: 'Datensicherung',
		description: 'Alle Daten verschlüsselt sichern und wiederherstellen oder zusammenführen.',
		href: '/admin/backup',
		icon: 'database-backup',
		permission: 'core.system.backup',
		keywords: ['Sicherung', 'Backup', 'Export', 'Import', 'Wiederherstellen', 'Umzug'],
		nav: true
	}
];

export function canSeeAdminEntry(permissions: readonly string[], e: AdminEntry): boolean {
	if (e.anyPermission) return e.anyPermission.some((p) => permissions.includes(p));
	return !e.permission || permissions.includes(e.permission);
}

/** Module mit eigener Einstellungsseite (`admin: true`) als Einträge im Abschnitt „Module“. */
export function moduleAdminEntries(navigation: readonly ModuleNavEntry[]): AdminEntry[] {
	return navigation
		.filter((n) => n.admin)
		.map((n) => {
			const name = n.moduleName ?? n.label;
			return {
				id: `module:${n.moduleId}:${n.path}`,
				section: 'modules' as const,
				label: name,
				description: `Einstellungen des Moduls ${name}`,
				href: n.path,
				icon: n.icon,
				keywords: [n.label, n.moduleId, 'Modul-Einstellungen'],
				nav: true
			};
		});
}

/** Alle für diese Rechte sichtbaren Einträge (Core + Modul-Einstellungsseiten), Reihenfolge der Registry. */
export function visibleAdminEntries(
	permissions: readonly string[],
	navigation: readonly ModuleNavEntry[] = []
): AdminEntry[] {
	return [
		...ADMIN_ENTRIES.filter((e) => canSeeAdminEntry(permissions, e)),
		...moduleAdminEntries(navigation)
	];
}

/** Reiter einer Seite (z. B. `settings`), gefiltert nach Rechten. */
export function adminTabs(parentId: string, permissions: readonly string[]): AdminEntry[] {
	return ADMIN_ENTRIES.filter((e) => e.parent === parentId && canSeeAdminEntry(permissions, e));
}

/** Kleinschreibung, Umlaute/ß gefaltet, Akzente entfernt – für tolerante Suche. */
export function normalizeSearch(s: string): string {
	return s
		.toLowerCase()
		.replace(/ä/g, 'ae')
		.replace(/ö/g, 'oe')
		.replace(/ü/g, 'ue')
		.replace(/ß/g, 'ss')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

/**
 * Sucht in Label (stärker), Keywords und Beschreibung. Alle Wörter der Anfrage müssen vorkommen.
 * Leere Anfrage → alle Einträge in Registry-Reihenfolge.
 */
export function searchAdmin<T extends AdminEntry>(entries: readonly T[], q: string): T[] {
	const words = normalizeSearch(q).split(' ').filter(Boolean);
	if (!words.length) return [...entries];
	const scored: { e: T; score: number; i: number }[] = [];
	entries.forEach((e, i) => {
		const label = normalizeSearch(e.label);
		const keys = normalizeSearch(e.keywords.join(' '));
		const desc = normalizeSearch(e.description);
		let score = 0;
		for (const w of words) {
			if (label.startsWith(w)) score += 30;
			else if (label.includes(w)) score += 20;
			else if (keys.includes(w)) score += 10;
			else if (desc.includes(w)) score += 3;
			else return;
		}
		scored.push({ e, score, i });
	});
	return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.e);
}
