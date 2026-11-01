import {
	ADMIN_ENTRIES,
	ADMIN_HOME,
	ADMIN_SECTIONS,
	visibleAdminEntries,
	type AdminSectionId
} from './admin-registry';
import { t } from '$lib/i18n';

export interface NavItem {
	label: string;
	href: string;
	icon: string;
	/** Ohne Angabe: für alle angemeldeten Benutzer sichtbar */
	permission?: string;
	/** Alternativ: eines dieser Rechte genügt */
	anyPermission?: readonly string[];
}

/** Immer sichtbar (oben, zusammen mit den Modulen); `label` übersetzt beim Zugriff */
export const PRIMARY_NAV: NavItem[] = [
	{
		get label() {
			return t('nav.dashboard');
		},
		href: '/dashboard',
		icon: 'layout-dashboard'
	}
];

/** Eintrag eines Moduls in der Seitenleiste (siehe ModuleNavigationItem). */
export interface ModuleNavEntry {
	label: string;
	icon: string;
	path: string;
	moduleId: string;
	/** Anzeigename des Moduls (für Modul-Einstellungen in der Verwaltung) */
	moduleName?: string;
	group?: string;
	groupIcon?: string;
	/** In der Gruppe „Administration“ anzeigen */
	admin?: boolean;
}

export const ADMIN_GROUP = {
	get label() {
		return t('nav.administration');
	},
	icon: 'wrench'
} as const;

/** Alle Core-Seiten der Seitenleiste (Startseite, Verwaltungsseiten aus `admin-registry.ts`). */
export const CORE_NAV: NavItem[] = [
	...PRIMARY_NAV,
	{
		get label() {
			return ADMIN_HOME.label;
		},
		href: ADMIN_HOME.href,
		icon: ADMIN_HOME.icon
	},
	...ADMIN_ENTRIES.filter((e) => e.nav).map((e) => ({
		get label() {
			return e.label;
		},
		href: e.href,
		icon: e.icon,
		permission: e.permission,
		anyPermission: e.anyPermission
	}))
];

export function hasPermission(permissions: readonly string[], key?: string | null): boolean {
	return !key || permissions.includes(key);
}

/** Sichtbarkeit eines Eintrags: `anyPermission` (eines genügt) vor `permission`. */
export function canSeeNavItem(permissions: readonly string[], item: NavItem): boolean {
	if (item.anyPermission) return item.anyPermission.some((p) => permissions.includes(p));
	return hasPermission(permissions, item.permission);
}

export function isActive(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(href + '/');
}

/** Link der Verwaltungsgruppe; `hint` = kleine Zusatzzeile (z. B. „Einstellungen“ bei Modulen). */
export interface AdminNavLink {
	label: string;
	href: string;
	icon: string;
	hint?: string;
	/** Nur bei exakt gleichem Pfad aktiv (Übersicht `/admin`) */
	exact?: boolean;
}

export interface AdminNavSection {
	id: AdminSectionId;
	label: string;
	items: AdminNavLink[];
}

export interface AdminNav {
	home: AdminNavLink;
	sections: AdminNavSection[];
}

/**
 * Verwaltungsgruppe der Seitenleiste: Abschnitte in Registry-Reihenfolge mit den sichtbaren
 * `nav`-Einträgen (Modul-Einstellungsseiten im Abschnitt „Module“ nach dem Core-Eintrag).
 * `null`, wenn außer der Übersicht nichts sichtbar wäre.
 */
export function buildAdminNav(
	permissions: readonly string[],
	navigation: readonly ModuleNavEntry[]
): AdminNav | null {
	const visible = visibleAdminEntries(permissions, navigation).filter((e) => e.nav);
	const sections = ADMIN_SECTIONS.map((s) => ({
		id: s.id,
		label: s.label,
		items: visible
			.filter((e) => e.section === s.id)
			.map((e): AdminNavLink => ({
				label: e.label,
				href: e.href,
				icon: e.icon,
				...(e.navHint ? { hint: e.navHint } : {})
			}))
	})).filter((s) => s.items.length > 0);
	if (!sections.length) return null;
	return {
		home: { label: ADMIN_HOME.label, href: ADMIN_HOME.href, icon: ADMIN_HOME.icon, exact: true },
		sections
	};
}
