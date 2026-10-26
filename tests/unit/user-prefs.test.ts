import { describe, expect, it } from 'vitest';
import { maskEmail } from '$lib/server/core/auth/mask-email';
import { THEME_PRESETS } from '$lib/appearance/presets';
import type { UserTheme } from '$lib/appearance/schema';
import { CORE_SETTINGS } from '$lib/server/core/settings/catalog';
import {
	applyAppearance,
	resolveStartPage,
	safeDensity,
	safeHexColor
} from '$lib/server/core/settings/user-prefs';

const def = (key: string) => CORE_SETTINGS.find((d) => d.key === key)!;

describe('Darstellung (app.html-Platzhalter)', () => {
	const html = '<html class="%app.theme%" data-density="%app.density%" style="%app.style%">';

	it('ersetzt Platzhalter mit validierten Werten', () => {
		expect(applyAppearance(html, { theme: 'dark', density: 'compact', accent: '#16A34A' })).toBe(
			'<html class="dark" data-density="compact" style="--accent-color:#16a34a">'
		);
		expect(applyAppearance(html, { theme: 'system', density: undefined, accent: null })).toBe(
			'<html class="" data-density="comfortable" style="">'
		);
	});

	it('setzt Theme-Variablen nur aus gültigen Themes', () => {
		const t = THEME_PRESETS[1]!;
		const out = applyAppearance('%app.apptheme%|%app.style%', {
			theme: '',
			density: '',
			accent: '#16a34a',
			appTheme: t
		});
		expect(out.startsWith('on|--accent-color:#16a34a;--app-bg-light:linear-gradient(')).toBe(true);
		const bad = {
			...t,
			light: { ...t.light, background: { kind: 'solid', color: 'red;}body{display:none' } }
		} as unknown as UserTheme;
		expect(
			applyAppearance('%app.apptheme%|%app.style%', {
				theme: '',
				density: '',
				accent: null,
				appTheme: bad
			})
		).toBe('|');
	});

	it('verwirft nicht-hexadezimale Akzentfarben (keine CSS-/HTML-Injektion)', () => {
		for (const bad of [
			'red',
			'#12345',
			'#1234567',
			'#12345g',
			'"><script>alert(1)</script>',
			'#16a34a;background:url(x)',
			'#16a34a" onload="x',
			''
		]) {
			expect(safeHexColor(bad)).toBeNull();
			const out = applyAppearance(html, { theme: '', density: 'compact', accent: bad });
			expect(out).toBe('<html class="" data-density="compact" style="">');
		}
		expect(safeDensity('"><x')).toBe('comfortable');
	});
});

describe('Startseite', () => {
	it('erlaubt Dashboard, Profil und Modulnavigation, sonst Dashboard', () => {
		const nav = ['/modules/members', '/modules/actions'];
		expect(resolveStartPage('/modules/members', nav)).toBe('/modules/members');
		expect(resolveStartPage('/profile', nav)).toBe('/profile');
		expect(resolveStartPage('/modules/treasury', nav)).toBe('/dashboard');
		expect(resolveStartPage('/users', nav)).toBe('/dashboard');
		expect(resolveStartPage('//evil.example', nav)).toBe('/dashboard');
		expect(resolveStartPage('https://evil.example', nav)).toBe('/dashboard');
	});
});

describe('Benutzer-Einstellungen (Zod)', () => {
	it('Akzentfarbe: leer oder #rrggbb', () => {
		const s = def('core.user.accentColor').schema;
		expect(s.safeParse('').success).toBe(true);
		expect(s.safeParse('#12ab34').success).toBe(true);
		expect(s.safeParse('red').success).toBe(false);
		expect(s.safeParse('#12ab3').success).toBe(false);
	});
	it('Dichte', () => {
		const s = def('core.user.density').schema;
		expect(s.safeParse('compact').success).toBe(true);
		expect(s.safeParse('comfortable').success).toBe(true);
		expect(s.safeParse('dense').success).toBe(false);
	});
	it('Startseite: nur Kleinbuchstaben, Ziffern, Bindestrich, Slash', () => {
		const s = def('core.user.startPage').schema;
		expect(s.safeParse('/dashboard').success).toBe(true);
		expect(s.safeParse('/modules/my-mod').success).toBe(true);
		expect(s.safeParse('dashboard').success).toBe(false);
		expect(s.safeParse('/Modules').success).toBe(false);
		expect(s.safeParse('/a?b=1').success).toBe(false);
		expect(s.safeParse('/x'.repeat(101)).success).toBe(false);
	});
	it('Einträge pro Seite 10-200', () => {
		const s = def('core.user.pageSize').schema;
		expect(s.safeParse(10).success).toBe(true);
		expect(s.safeParse('200').success).toBe(true);
		expect(s.safeParse(9).success).toBe(false);
		expect(s.safeParse(201).success).toBe(false);
	});
	it('alle Benutzer-Einstellungen gehören zur Gruppe user', () => {
		for (const d of CORE_SETTINGS.filter((x) => x.scope === 'user')) expect(d.group).toBe('user');
	});
});

describe('maskEmail', () => {
	it('zeigt nur den ersten Buchstaben und die Domain', () => {
		expect(maskEmail('anna@example.org')).toBe('a***@example.org');
		expect(maskEmail('@x')).toBe('***');
		expect(maskEmail('kaputt')).toBe('***');
	});
});
