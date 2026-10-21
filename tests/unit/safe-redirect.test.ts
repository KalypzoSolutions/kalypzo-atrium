import { describe, expect, it } from 'vitest';
import { isSafeRelativeHref, safeRedirect, safeRelativePath } from '$lib/server/core/safe-redirect';
import { safeRedirect as loginRedirect } from '../../src/routes/login/auth-error';

/** Ziele, die zum Fallback führen müssen (Issue #13). */
const UNSAFE: [string, string][] = [
	// Steuerzeichen roh (Browser entfernen Tab/CR/LF → `//evil.example`)
	['Tab nach /', '/\t/evil.example'],
	['LF nach /', '/\n/evil.example'],
	['CR nach /', '/\r/evil.example'],
	['NUL', '/\u0000/evil.example'],
	['DEL', '/a\u007fb'],
	['Steuerzeichen mitten im Pfad', '/dashboard\t'],
	['Leerzeichen', '/ /evil.example'],
	['geschütztes Leerzeichen', '/ /evil.example'],
	// Steuerzeichen kodiert
	['%09', '/%09/evil.example'],
	['%0a', '/%0a/evil.example'],
	['%0D', '/%0D/evil.example'],
	['%00', '/a%00b'],
	['%7f', '/a%7fb'],
	// Backslash roh und kodiert
	['/\\', '/\\evil.example'],
	['\\\\', '\\\\evil.example'],
	['\\/', '\\/evil.example'],
	['Backslash im Pfad', '/a\\b'],
	['%5c', '/%5cevil.example'],
	['%5C', '/%5C%5Cevil.example'],
	// protokollrelativ / absolut
	['//', '//evil.example'],
	['///', '///evil.example'],
	['//mit Pfad', '//evil.example/login'],
	['https', 'https://evil.example/'],
	['http', 'http://evil.example'],
	['javascript', 'javascript:alert(1)'],
	['data', 'data:text/html,x'],
	['mailto', 'mailto:a@b.c'],
	['ohne Schrägstrich', 'dashboard'],
	['Punkt-relativ', './dashboard'],
	['nur Query', '?x=1'],
	['nur Hash', '#x'],
	// Normalisierung erzeugt `//`
	['/.//', '/.//evil.example'],
	['/x/..//', '/x/..//evil.example'],
	// leer / zu lang
	['leer', ''],
	['zu lang', `/${'a'.repeat(2048)}`]
];

/** Gültige relative Pfade bleiben erhalten (inkl. Query und Hash). */
const SAFE: [string, string][] = [
	['/', '/'],
	['/dashboard', '/dashboard'],
	['/modules/actions/123', '/modules/actions/123'],
	['/modules/members?open=abc&x=1', '/modules/members?open=abc&x=1'],
	['/events?event=1#heute', '/events?event=1#heute'],
	['/pfad%20mit%20leer', '/pfad%20mit%20leer'],
	['/a/%2F/b', '/a/%2F/b'],
	['/admin/../dashboard', '/dashboard'],
	['/a/./b', '/a/b'],
	['/umlaut-ä', '/umlaut-%C3%A4'],
	['/login-hilfe', '/login-hilfe']
];

describe('safeRelativePath', () => {
	it.each(UNSAFE)('lehnt ab: %s', (_label, target) => {
		expect(safeRelativePath(target)).toBeNull();
		expect(safeRedirect(target, '/fb')).toBe('/fb');
		expect(isSafeRelativeHref(target)).toBe(false);
	});

	it.each(SAFE)('erlaubt: %s', (target, expected) => {
		expect(safeRelativePath(target)).toBe(expected);
		expect(safeRedirect(target, '/fb')).toBe(expected);
		expect(isSafeRelativeHref(target)).toBe(true);
	});

	it('lehnt Nicht-Strings ab', () => {
		for (const v of [null, undefined, 1, {}, ['/x']]) {
			expect(safeRelativePath(v)).toBeNull();
			expect(isSafeRelativeHref(v)).toBe(false);
		}
		expect(safeRedirect(null)).toBe('/');
		expect(safeRedirect(undefined, '/fb')).toBe('/fb');
	});

	it('Ergebnis bleibt bei derselben Origin, auch gegen einen echten Host aufgelöst', () => {
		for (const [, target] of [...UNSAFE, ...SAFE]) {
			const out = safeRedirect(target, '/fb');
			expect(new URL(out, 'https://intern.example.org').origin).toBe('https://intern.example.org');
		}
	});
});

describe('safeRedirect mit ausgeschlossenen Präfixen', () => {
	it('sperrt ganze Segmente, nicht Teilwörter', () => {
		const ex = ['/login'];
		expect(safeRedirect('/login', '/fb', ex)).toBe('/fb');
		expect(safeRedirect('/login?redirectTo=/x', '/fb', ex)).toBe('/fb');
		expect(safeRedirect('/login#x', '/fb', ex)).toBe('/fb');
		expect(safeRedirect('/login/', '/fb', ex)).toBe('/fb');
		expect(safeRedirect('/./login', '/fb', ex)).toBe('/fb');
		expect(safeRedirect('/x/../login', '/fb', ex)).toBe('/fb');
		expect(safeRedirect('/login-hilfe', '/fb', ex)).toBe('/login-hilfe');
	});
});

describe('Login: safeRedirect (auth-error)', () => {
	it.each(UNSAFE)('fällt zurück auf /dashboard: %s', (_label, target) => {
		expect(loginRedirect(target)).toBe('/dashboard');
	});

	it('erlaubt normale Ziele und sperrt /login', () => {
		expect(loginRedirect('/modules/actions?tab=x#y')).toBe('/modules/actions?tab=x#y');
		expect(loginRedirect('/login')).toBe('/dashboard');
		expect(loginRedirect('/login?redirectTo=%2Fx')).toBe('/dashboard');
		expect(loginRedirect(null)).toBe('/dashboard');
		expect(loginRedirect('/profile', '/start')).toBe('/profile');
		expect(loginRedirect('//evil.example', '/start')).toBe('/start');
	});
});
