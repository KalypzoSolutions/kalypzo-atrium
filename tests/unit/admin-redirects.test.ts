import { describe, expect, it } from 'vitest';
import {
	LEGACY_ADMIN_REDIRECTS,
	legacyAdminRedirect
} from '../../src/lib/server/core/admin-redirects';

describe('legacyAdminRedirect', () => {
	it.each([
		['/users', '/admin/users'],
		['/roles', '/admin/roles'],
		['/permissions', '/admin/roles/permissions'],
		['/modules', '/admin/modules'],
		['/api-keys', '/admin/api'],
		['/api-docs', '/admin/api/docs'],
		['/settings', '/admin/settings'],
		['/ai', '/admin/settings/ai'],
		['/storage', '/admin/settings/storage'],
		['/pdf', '/admin/settings/pdf'],
		['/audit', '/admin/audit'],
		['/system/reset', '/admin/reset']
	])('%s → %s', (from, to) => {
		expect(legacyAdminRedirect(from)).toBe(to);
	});

	it('Unterpfade wandern mit', () => {
		expect(legacyAdminRedirect('/system/reset/export')).toBe('/admin/reset/export');
		expect(legacyAdminRedirect('/settings/mail-preview')).toBe('/admin/settings/mail-preview');
		expect(legacyAdminRedirect('/pdf/stamm-brief')).toBe('/admin/settings/pdf/stamm-brief');
		expect(legacyAdminRedirect('/users/abc')).toBe('/admin/users/abc');
	});

	it('Moduloberflächen bleiben (exakt nur /modules)', () => {
		expect(legacyAdminRedirect('/modules/treasury')).toBeNull();
		expect(legacyAdminRedirect('/modules/treasury/settings')).toBeNull();
	});

	it('nur ganze Pfadsegmente', () => {
		expect(legacyAdminRedirect('/modulesx')).toBeNull();
		expect(legacyAdminRedirect('/usersx')).toBeNull();
		expect(legacyAdminRedirect('/aix')).toBeNull();
		expect(legacyAdminRedirect('/pdfs')).toBeNull();
		expect(legacyAdminRedirect('/system')).toBeNull();
	});

	it('neue und andere Pfade bleiben unverändert', () => {
		for (const p of ['/', '/dashboard', '/profile', '/admin', '/admin/users', '/admin/settings/ai'])
			expect(legacyAdminRedirect(p)).toBeNull();
	});

	it('jedes Ziel liegt unter /admin, Quellen sind eindeutig', () => {
		for (const r of LEGACY_ADMIN_REDIRECTS) expect(r.to.startsWith('/admin/')).toBe(true);
		const froms = LEGACY_ADMIN_REDIRECTS.map((r) => r.from);
		expect(new Set(froms).size).toBe(froms.length);
	});
});
