/**
 * Phase N: Texte der Core-Einstellungen und der Verwaltungs-Registry werden über Schlüssel übersetzt
 * (`settings.<schlüssel>.label`, `admin.entries.<id>.*`). Jeder Eintrag braucht Texte in allen Sprachen.
 */
import { describe, expect, it } from 'vitest';
import { ensureLocale, hasMessage, setLocaleResolver, type Locale } from '$lib/i18n';
import { CORE_SETTINGS, settingTextKey } from '$lib/server/core/settings/catalog';
import {
	ADMIN_ENTRIES,
	ADMIN_HOME,
	ADMIN_SECTIONS,
	searchAdmin
} from '$lib/components/layout/admin-registry';
import { ADMIN_GROUP, PRIMARY_NAV } from '$lib/components/layout/nav';

let current: Locale = 'de';
setLocaleResolver(() => current);

describe('Einstellungskatalog', () => {
	it('jede Core-Einstellung hat ein Label in de und en; Beschreibung nur, wenn in beiden', async () => {
		await ensureLocale('en');
		const missing: string[] = [];
		for (const d of CORE_SETTINGS) {
			for (const l of ['de', 'en'] as const) {
				if (!hasMessage(settingTextKey(d.key, 'label'), l)) missing.push(`${d.key} label ${l}`);
			}
			const desc = settingTextKey(d.key, 'description');
			if (hasMessage(desc, 'de') !== hasMessage(desc, 'en')) missing.push(`${d.key} description`);
		}
		expect(missing).toEqual([]);
	});

	it('Label und Beschreibung folgen der Sprache des Aufrufs', async () => {
		await ensureLocale('en');
		const name = CORE_SETTINGS.find((d) => d.key === 'core.system.name')!;
		const locale = CORE_SETTINGS.find((d) => d.key === 'core.system.locale')!;
		current = 'de';
		expect(name.label).toBe('Systemname');
		expect(name.description).toBeUndefined();
		expect(locale.description).toContain('Browsersprache');
		current = 'en';
		expect(name.label).toBe('System name');
		expect(locale.label).toBe('Language');
		current = 'de';
	});
});

describe('Verwaltungs-Registry', () => {
	it('Abschnitte und Einträge haben Texte in beiden Sprachen', async () => {
		await ensureLocale('en');
		for (const l of ['de', 'en'] as const) {
			current = l;
			for (const s of ADMIN_SECTIONS) {
				expect(s.label, s.id).not.toMatch(/^admin\./);
				expect(s.description, s.id).not.toMatch(/^admin\./);
			}
			for (const e of ADMIN_ENTRIES) {
				expect(e.label, e.id).not.toMatch(/^admin\./);
				expect(e.description, e.id).not.toMatch(/^admin\./);
				expect(e.keywords.length, e.id).toBeGreaterThan(0);
			}
			expect(ADMIN_HOME.label).not.toMatch(/^admin\./);
			expect(ADMIN_GROUP.label).not.toMatch(/^nav\./);
			expect(PRIMARY_NAV[0]!.label).not.toMatch(/^nav\./);
		}
		current = 'de';
	});

	it('Englisch: Suche in englischen Begriffen, deutsche treffen zusätzlich', async () => {
		await ensureLocale('en');
		current = 'en';
		const users = ADMIN_ENTRIES.find((e) => e.id === 'users')!;
		expect(users.label).toBe('Users');
		expect(searchAdmin(ADMIN_ENTRIES, 'password')[0]?.id).toBe('users');
		expect(searchAdmin(ADMIN_ENTRIES, 'Passwort').map((e) => e.id)).toContain('users');
		expect(searchAdmin(ADMIN_ENTRIES, 'backup')[0]?.id).toBe('backup');
		current = 'de';
		expect(users.label).toBe('Benutzer');
		expect(users.keywords).not.toContain('password');
	});
});
