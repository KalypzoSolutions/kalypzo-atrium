/**
 * Verwaltungsbereich (`/admin`): Abschnitte, Seiten, Reiter und Suchbegriffe – EINE Quelle für Seitenleiste,
 * Übersicht, Befehlspalette und Reiterleisten. Rein und client-tauglich.
 *
 * Texte (Phase N): `label`, `description` und `keywords` sind Getter und übersetzen beim Zugriff
 * (`messages/<sprache>/admin.json`, `admin.sections.<id>` bzw. `admin.entries.<id mit - statt .>`). Suchbegriffe
 * stehen kommagetrennt je Sprache; die deutschen treffen in jeder Sprache zusätzlich.
 */
import { getLocale, t, tl } from '$lib/i18n';
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
	/** Kleine Zusatzzeile in der Seitenleiste (Modul-Einträge: „Einstellungen“ bzw. Modulname) */
	navHint?: string;
}

/** Kommagetrennte Suchbegriffe → Liste */
const splitKeywords = (s: string) =>
	s
		.split(',')
		.map((k) => k.trim())
		.filter(Boolean);

/** Suchbegriffe in der aktuellen Sprache plus die deutschen (ohne Doppelungen) */
function keywordsFor(key: string): string[] {
	const own = splitKeywords(t(key));
	if (getLocale() === 'de') return own;
	return [...new Set([...own, ...splitKeywords(tl('de', key))])];
}

function section(id: AdminSectionId, icon: string): AdminSection {
	return {
		id,
		icon,
		get label() {
			return t(`admin.sections.${id}.label`);
		},
		get description() {
			return t(`admin.sections.${id}.description`);
		}
	};
}

function entry(def: Omit<AdminEntry, 'label' | 'description' | 'keywords'>): AdminEntry {
	const base = `admin.entries.${def.id.replace(/\./g, '-')}`;
	return {
		...def,
		get label() {
			return t(`${base}.label`);
		},
		get description() {
			return t(`${base}.description`);
		},
		get keywords() {
			return keywordsFor(`${base}.keywords`);
		}
	};
}

export const ADMIN_HOME = {
	get label() {
		return t('admin.home');
	},
	href: '/admin',
	icon: 'layout-grid'
} as const;

export const ADMIN_SECTIONS: readonly AdminSection[] = [
	section('people', 'users'),
	section('settings', 'settings'),
	section('modules', 'puzzle'),
	section('api', 'terminal'),
	section('maintenance', 'scroll-text')
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
	entry({
		id: 'users',
		section: 'people',
		href: '/admin/users',
		icon: 'users',
		permission: 'core.users.view',
		nav: true
	}),
	entry({
		id: 'roles',
		section: 'people',
		href: '/admin/roles',
		icon: 'shield',
		permission: 'core.roles.view',
		nav: true
	}),
	entry({
		id: 'roles.permissions',
		section: 'people',
		href: '/admin/roles/permissions',
		icon: 'key-round',
		permission: 'core.roles.view',
		parent: 'roles'
	}),
	// Einstellungen
	entry({
		id: 'settings',
		section: 'settings',
		href: '/admin/settings',
		icon: 'settings',
		anyPermission: SETTINGS_ANY,
		nav: true
	}),
	entry({
		id: 'settings.general',
		section: 'settings',
		href: '/admin/settings/general',
		icon: 'settings',
		permission: 'core.settings.view',
		parent: 'settings'
	}),
	entry({
		id: 'settings.design',
		section: 'settings',
		href: '/admin/settings/design',
		icon: 'sparkles',
		permission: 'core.settings.view',
		parent: 'settings'
	}),
	entry({
		id: 'settings.mail',
		section: 'settings',
		href: '/admin/settings/mail',
		icon: 'mail',
		permission: 'core.settings.view',
		parent: 'settings'
	}),
	entry({
		id: 'settings.mail-layout',
		section: 'settings',
		href: '/admin/settings/mail-layout',
		icon: 'mail',
		permission: 'core.settings.view',
		parent: 'settings'
	}),
	entry({
		id: 'settings.storage',
		section: 'settings',
		href: '/admin/settings/storage',
		icon: 'hard-drive',
		permission: 'core.storage.manage',
		parent: 'settings'
	}),
	entry({
		id: 'settings.notifications',
		section: 'settings',
		href: '/admin/settings/notifications',
		icon: 'bell',
		permission: 'core.settings.view',
		parent: 'settings'
	}),
	entry({
		id: 'settings.ai',
		section: 'settings',
		href: '/admin/settings/ai',
		icon: 'sparkles',
		anyPermission: ['core.ai.view', 'core.ai.manage'],
		parent: 'settings'
	}),
	entry({
		id: 'settings.pdf',
		section: 'settings',
		href: '/admin/settings/pdf',
		icon: 'file-text',
		permission: 'core.pdf.manage',
		parent: 'settings'
	}),
	entry({
		id: 'settings.modules',
		section: 'settings',
		href: '/admin/settings/modules',
		icon: 'puzzle',
		permission: 'core.settings.view',
		parent: 'settings'
	}),
	// Module
	entry({
		id: 'modules',
		section: 'modules',
		href: '/admin/modules',
		icon: 'puzzle',
		permission: 'core.modules.view',
		nav: true
	}),
	entry({
		id: 'modules.install',
		section: 'modules',
		href: '/admin/modules/install',
		icon: 'download',
		permission: 'core.modules.install',
		parent: 'modules'
	}),
	entry({
		id: 'modules.history',
		section: 'modules',
		href: '/admin/modules/history',
		icon: 'history',
		permission: 'core.modules.view',
		parent: 'modules'
	}),
	// Schnittstellen
	entry({
		id: 'api',
		section: 'api',
		href: '/admin/api',
		icon: 'key-round',
		permission: 'core.api.view',
		nav: true
	}),
	entry({
		id: 'api.docs',
		section: 'api',
		href: '/admin/api/docs',
		icon: 'terminal',
		permission: 'core.api.view',
		parent: 'api'
	}),
	// Protokoll & Wartung
	entry({
		id: 'audit',
		section: 'maintenance',
		href: '/admin/audit',
		icon: 'scroll-text',
		permission: 'core.audit.view',
		nav: true
	}),
	entry({
		id: 'reset',
		section: 'maintenance',
		href: '/admin/reset',
		icon: 'rotate-ccw',
		permission: 'core.system.reset',
		nav: true
	}),
	entry({
		id: 'backup',
		section: 'maintenance',
		href: '/admin/backup',
		icon: 'database-backup',
		permission: 'core.system.backup',
		nav: true
	}),
	entry({
		id: 'privacy',
		section: 'people',
		href: '/admin/privacy',
		icon: 'shield',
		permission: 'core.privacy.export',
		nav: true
	})
];

export function canSeeAdminEntry(permissions: readonly string[], e: AdminEntry): boolean {
	if (e.anyPermission) return e.anyPermission.some((p) => permissions.includes(p));
	return !e.permission || permissions.includes(e.permission);
}

/**
 * Module mit eigener Einstellungsseite (`admin: true`) als Einträge im Abschnitt „Module“. Eine Seite je
 * Modul heißt wie das Modul („Kasse“); hat ein Modul mehrere, heißen sie nach ihrem Navigationslabel
 * („Zusatzfelder“) mit dem Modulnamen als Zusatzzeile.
 */
export function moduleAdminEntries(navigation: readonly ModuleNavEntry[]): AdminEntry[] {
	const admin = navigation.filter((n) => n.admin);
	const perModule = new Map<string, number>();
	for (const n of admin) perModule.set(n.moduleId, (perModule.get(n.moduleId) ?? 0) + 1);
	return admin.map((n) => {
		const name = n.moduleName ?? n.label;
		const several = (perModule.get(n.moduleId) ?? 0) > 1;
		return {
			id: `module:${n.moduleId}:${n.path}`,
			section: 'modules' as const,
			label: several ? n.label : name,
			description: several
				? t('admin.moduleEntry.pageOf', { page: n.label, module: name })
				: t('admin.moduleEntry.settingsOf', { module: name }),
			href: n.path,
			icon: n.icon,
			keywords: [n.label, name, n.moduleId, ...keywordsFor('admin.moduleEntry.keywords')],
			nav: true,
			navHint: several ? name : t('admin.moduleEntry.hint')
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
