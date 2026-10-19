/**
 * Alte Verwaltungs-URLs (vor dem Umzug nach `/admin`, 2026-10-19) → neue Pfade. Rein, ohne Server-Abhängigkeiten.
 * Unterpfade wandern mit (`/system/reset/export` → `/admin/reset/export`), außer bei `exact`.
 */
export const LEGACY_ADMIN_REDIRECTS: readonly { from: string; to: string; exact?: boolean }[] = [
	{ from: '/users', to: '/admin/users' },
	{ from: '/roles', to: '/admin/roles' },
	{ from: '/permissions', to: '/admin/roles/permissions' },
	// `/modules/<id>/…` sind die Moduloberflächen und bleiben, wo sie sind
	{ from: '/modules', to: '/admin/modules', exact: true },
	{ from: '/api-keys', to: '/admin/api' },
	{ from: '/api-docs', to: '/admin/api/docs' },
	{ from: '/settings', to: '/admin/settings' },
	{ from: '/ai', to: '/admin/settings/ai' },
	{ from: '/storage', to: '/admin/settings/storage' },
	{ from: '/pdf', to: '/admin/settings/pdf' },
	{ from: '/audit', to: '/admin/audit' },
	{ from: '/system/reset', to: '/admin/reset' }
];

/** Neuer Pfad für eine alte Verwaltungs-URL oder `null`. */
export function legacyAdminRedirect(pathname: string): string | null {
	for (const r of LEGACY_ADMIN_REDIRECTS) {
		if (pathname === r.from) return r.to;
		if (!r.exact && pathname.startsWith(r.from + '/')) return r.to + pathname.slice(r.from.length);
	}
	return null;
}
