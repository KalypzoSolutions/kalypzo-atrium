export interface NavItem {
	label: string;
	href: string;
	icon: string;
	/** Ohne Angabe: fuer alle angemeldeten Benutzer sichtbar */
	permission?: string;
}

/** Immer sichtbar (oben, zusammen mit den Modulen) */
export const PRIMARY_NAV: NavItem[] = [
	{ label: 'Dashboard', href: '/dashboard', icon: 'layout-dashboard' }
];

/** Verwaltungs-Eintraege: in der Seitenleiste in einer einklappbaren Gruppe */
export const ADMIN_NAV: NavItem[] = [
	{ label: 'Benutzer', href: '/users', icon: 'users', permission: 'core.users.view' },
	{ label: 'Rollen', href: '/roles', icon: 'shield', permission: 'core.roles.view' },
	{
		label: 'Berechtigungen',
		href: '/permissions',
		icon: 'key-round',
		permission: 'core.roles.view'
	},
	{ label: 'Module', href: '/modules', icon: 'puzzle', permission: 'core.modules.view' },
	{ label: 'API-Keys', href: '/api-keys', icon: 'terminal', permission: 'core.api.view' },
	{ label: 'Einstellungen', href: '/settings', icon: 'settings', permission: 'core.settings.view' },
	{ label: 'KI', href: '/ai', icon: 'sparkles', permission: 'core.ai.view' },
	{ label: 'Storage', href: '/storage', icon: 'hard-drive', permission: 'core.storage.manage' },
	{ label: 'PDF', href: '/pdf', icon: 'file-text', permission: 'core.pdf.manage' },
	{ label: 'Audit-Logs', href: '/audit', icon: 'scroll-text', permission: 'core.audit.view' }
];

/** Eintrag eines Moduls in der Seitenleiste (siehe ModuleNavigationItem). */
export interface ModuleNavEntry {
	label: string;
	icon: string;
	path: string;
	moduleId: string;
	group?: string;
	groupIcon?: string;
	/** In der Gruppe „Administration“ anzeigen */
	admin?: boolean;
}

export const ADMIN_GROUP = { label: 'Administration', icon: 'wrench' } as const;

export const CORE_NAV: NavItem[] = [...PRIMARY_NAV, ...ADMIN_NAV];

export function hasPermission(permissions: readonly string[], key?: string | null): boolean {
	return !key || permissions.includes(key);
}

export function isActive(pathname: string, href: string): boolean {
	return pathname === href || pathname.startsWith(href + '/');
}
