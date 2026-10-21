import { describe, expect, it } from 'vitest';
import {
	ADMIN_ENTRIES,
	ADMIN_SECTIONS,
	adminTabs,
	canSeeAdminEntry,
	moduleAdminEntries,
	normalizeSearch,
	searchAdmin,
	visibleAdminEntries,
	type AdminEntry
} from '$lib/components/layout/admin-registry';
import type { ModuleNavEntry } from '$lib/components/layout/nav';

const ALL_PERMISSIONS = [
	'core.users.view',
	'core.roles.view',
	'core.settings.view',
	'core.ai.view',
	'core.storage.manage',
	'core.pdf.manage',
	'core.modules.view',
	'core.api.view',
	'core.audit.view',
	'core.system.reset',
	'core.system.backup',
	'core.privacy.export'
];

const ids = (entries: readonly AdminEntry[]) => entries.map((e) => e.id);
const byId = (id: string) => ADMIN_ENTRIES.find((e) => e.id === id)!;

const treasuryNav: ModuleNavEntry = {
	label: 'Kasse-Einstellungen',
	icon: 'wallet',
	path: '/modules/treasury/settings',
	moduleId: 'treasury',
	moduleName: 'Kasse',
	admin: true
};

describe('Registry-Struktur', () => {
	it('alle hrefs sind eindeutig und beginnen mit /admin', () => {
		const hrefs = ADMIN_ENTRIES.map((e) => e.href);
		expect(new Set(hrefs).size).toBe(hrefs.length);
		for (const h of hrefs) expect(h.startsWith('/admin/') || h === '/admin').toBe(true);
	});

	it('alle IDs sind eindeutig', () => {
		const all = ids(ADMIN_ENTRIES);
		expect(new Set(all).size).toBe(all.length);
	});

	it('jede section existiert', () => {
		const sections = new Set(ADMIN_SECTIONS.map((s) => s.id));
		for (const e of ADMIN_ENTRIES) expect(sections.has(e.section), e.id).toBe(true);
	});

	it('jeder parent existiert, liegt im selben Abschnitt und ist selbst eine Seite', () => {
		for (const e of ADMIN_ENTRIES.filter((x) => x.parent)) {
			const parent = ADMIN_ENTRIES.find((p) => p.id === e.parent);
			expect(parent, e.id).toBeDefined();
			expect(parent!.section).toBe(e.section);
			expect(parent!.parent).toBeUndefined();
			expect(e.href.startsWith(parent!.href + '/')).toBe(true);
		}
	});

	it('Reiter erscheinen nicht in der Seitenleiste', () => {
		for (const e of ADMIN_ENTRIES.filter((x) => x.parent)) expect(e.nav).toBeFalsy();
	});
});

describe('canSeeAdminEntry', () => {
	it('permission: nur mit genau diesem Recht', () => {
		const users = byId('users');
		expect(canSeeAdminEntry(['core.users.view'], users)).toBe(true);
		expect(canSeeAdminEntry(['core.roles.view'], users)).toBe(false);
		expect(canSeeAdminEntry([], users)).toBe(false);
	});

	it('anyPermission: eines der Rechte genügt', () => {
		const settings = byId('settings');
		expect(settings.anyPermission).toBeDefined();
		expect(canSeeAdminEntry(['core.ai.view'], settings)).toBe(true);
		expect(canSeeAdminEntry(['core.pdf.manage'], settings)).toBe(true);
		expect(canSeeAdminEntry(['core.users.view'], settings)).toBe(false);
	});

	it('ohne Rechteangabe für alle sichtbar', () => {
		const open: AdminEntry = { ...byId('users'), permission: undefined };
		expect(canSeeAdminEntry([], open)).toBe(true);
	});
});

describe('visibleAdminEntries', () => {
	it('filtert nach Rechten, Registry-Reihenfolge', () => {
		const v = visibleAdminEntries(['core.audit.view', 'core.users.view']);
		expect(ids(v)).toEqual(['users', 'audit']);
	});

	it('alle Rechte → alle Core-Einträge', () => {
		expect(ids(visibleAdminEntries(ALL_PERMISSIONS))).toEqual(ids(ADMIN_ENTRIES));
	});

	it('hängt Modul-Einstellungsseiten mit moduleName an', () => {
		const nav: ModuleNavEntry[] = [
			treasuryNav,
			{ label: 'Termine', icon: 'calendar', path: '/modules/events', moduleId: 'events' }
		];
		const v = visibleAdminEntries([], nav);
		expect(v).toHaveLength(1);
		const m = v[0]!;
		expect(m.label).toBe('Kasse');
		expect(m.section).toBe('modules');
		expect(m.href).toBe('/modules/treasury/settings');
		expect(m.nav).toBe(true);
		expect(m.keywords).toContain('Kasse-Einstellungen');
		expect(m.keywords).toContain('treasury');
		expect(m.description).toContain('Kasse');
	});

	it('Modul-Eintrag ohne moduleName nutzt das Label', () => {
		const [m] = moduleAdminEntries([{ ...treasuryNav, moduleName: undefined }]);
		expect(m!.label).toBe('Kasse-Einstellungen');
	});
});

describe('adminTabs', () => {
	const settingsTabs = (perms: string[]) => ids(adminTabs('settings', perms));

	it('alle Einstellungs-Reiter bei allen Rechten', () => {
		expect(settingsTabs(ALL_PERMISSIONS)).toEqual([
			'settings.general',
			'settings.design',
			'settings.mail',
			'settings.mail-layout',
			'settings.storage',
			'settings.ai',
			'settings.pdf',
			'settings.modules'
		]);
	});

	it('je Recht nur die passenden Reiter', () => {
		expect(settingsTabs(['core.settings.view'])).toEqual([
			'settings.general',
			'settings.design',
			'settings.mail',
			'settings.mail-layout',
			'settings.modules'
		]);
		expect(settingsTabs(['core.ai.view'])).toEqual(['settings.ai']);
		expect(settingsTabs(['core.storage.manage'])).toEqual(['settings.storage']);
		expect(settingsTabs(['core.pdf.manage'])).toEqual(['settings.pdf']);
		expect(settingsTabs([])).toEqual([]);
	});

	it('Reiter von Rollen und API', () => {
		expect(ids(adminTabs('roles', ['core.roles.view']))).toEqual(['roles.permissions']);
		expect(ids(adminTabs('api', ['core.api.view']))).toEqual(['api.docs']);
		expect(ids(adminTabs('api', []))).toEqual([]);
	});
});

describe('normalizeSearch', () => {
	it('faltet Umlaute, ß und Satzzeichen', () => {
		expect(normalizeSearch('Fußzeile')).toBe('fusszeile');
		expect(normalizeSearch('Änderungen')).toBe('aenderungen');
		expect(normalizeSearch('  E-Mail-Versand ')).toBe('e mail versand');
		expect(normalizeSearch('Café')).toBe('cafe');
	});
});

describe('searchAdmin', () => {
	const entries = ADMIN_ENTRIES;

	it('leere Anfrage → alle Einträge in Registry-Reihenfolge', () => {
		expect(ids(searchAdmin(entries, ''))).toEqual(ids(entries));
		expect(ids(searchAdmin(entries, '   '))).toEqual(ids(entries));
	});

	it('Umlaute: „Fußzeile“ und „fusszeile“ finden das E-Mail-Layout', () => {
		expect(ids(searchAdmin(entries, 'Fußzeile'))[0]).toBe('settings.mail-layout');
		expect(ids(searchAdmin(entries, 'fusszeile'))[0]).toBe('settings.mail-layout');
	});

	it('„smtp“ findet den E-Mail-Versand', () => {
		const r = searchAdmin(entries, 'smtp');
		expect(r[0]!.label).toBe('E-Mail-Versand');
		expect(r[0]!.href).toBe('/admin/settings/mail');
	});

	it('„logo“ findet Design', () => {
		expect(searchAdmin(entries, 'logo')[0]!.href).toBe('/admin/settings/design');
	});

	it('Sicherung/Backup führen zuerst zur Datensicherung', () => {
		for (const q of ['backup', 'sicherung', 'wiederherstellen']) {
			expect(ids(searchAdmin(entries, q))[0]).toBe('backup');
		}
	});

	it('Label-Treffer vor Keyword-Treffer', () => {
		// „Rollen“ im Label, „Berechtigungen“ nennt Rollen nur in der Beschreibung
		const r = ids(searchAdmin(entries, 'rolle'));
		expect(r[0]).toBe('roles');
		// Label-Treffer „Module“ (Modulverwaltung, Reiter) vor reinem Keyword-Treffer
		const m = searchAdmin(entries, 'modul');
		const firstKeywordOnly = m.findIndex((e) => !normalizeSearch(e.label).includes('modul'));
		const lastLabel = m.map((e) => normalizeSearch(e.label).includes('modul')).lastIndexOf(true);
		expect(lastLabel).toBeGreaterThanOrEqual(0);
		if (firstKeywordOnly >= 0) expect(lastLabel).toBeLessThan(firstKeywordOnly);
	});

	it('mehrere Wörter: alle müssen vorkommen (UND)', () => {
		const r = ids(searchAdmin(entries, 'smtp absender'));
		expect(r).toEqual(['settings.mail']);
		expect(searchAdmin(entries, 'smtp logo')).toEqual([]);
	});

	it('kein Treffer → leere Liste', () => {
		expect(searchAdmin(entries, 'xyzunbekannt')).toEqual([]);
	});

	it('findet Modul-Einstellungsseiten über Modulnamen und ID', () => {
		const all = visibleAdminEntries(ALL_PERMISSIONS, [treasuryNav]);
		expect(searchAdmin(all, 'kasse')[0]!.href).toBe('/modules/treasury/settings');
		expect(searchAdmin(all, 'treasury')[0]!.href).toBe('/modules/treasury/settings');
	});
});
