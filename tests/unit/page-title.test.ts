import { describe, expect, it } from 'vitest';
import { documentTitle, navLabelFor } from '$lib/components/layout/page-title';

describe('documentTitle (#71)', () => {
	it('Format „Seite – Systemname“', () => {
		expect(documentTitle('Termine', 'Stamm Edelweiß')).toBe('Termine – Stamm Edelweiß');
	});
	it('fehlende Teile', () => {
		expect(documentTitle('Termine', '')).toBe('Termine');
		expect(documentTitle(null, 'Stamm')).toBe('Stamm');
		expect(documentTitle('  ', null)).toBe('Kalypzo Atrium');
		expect(documentTitle('Stamm', 'Stamm')).toBe('Stamm');
	});
});

describe('navLabelFor', () => {
	const nav = [
		{ label: 'Mitglieder', path: '/modules/members' },
		{ label: 'Zusatzfelder', path: '/modules/members/fields' },
		{ label: 'Gruppen', path: '/modules/members/groups/' }
	];
	it('längster passender Eintrag gewinnt', () => {
		expect(navLabelFor(nav, '/modules/members')).toBe('Mitglieder');
		expect(navLabelFor(nav, '/modules/members/fields')).toBe('Zusatzfelder');
		expect(navLabelFor(nav, '/modules/members/groups/abc')).toBe('Gruppen');
		expect(navLabelFor(nav, '/modules/members/123')).toBe('Mitglieder');
	});
	it('kein Präfix-Treffer ohne Pfadgrenze', () => {
		expect(navLabelFor(nav, '/modules/membersx')).toBeNull();
		expect(navLabelFor([], '/modules/x')).toBeNull();
	});
});
