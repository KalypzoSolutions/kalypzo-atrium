import { describe, expect, it } from 'vitest';
import {
	ACCESS_OPTIONS,
	METHOD_OPTIONS,
	catalogStats,
	filterEntries,
	filterFromSearchParams,
	filterToSearchParams,
	groupEntries,
	moduleOptions
} from '../../src/lib/api-docs/filter';
import { sampleCatalog } from '../fixtures/api-catalog';

const all = sampleCatalog.entries;
const ids = (list: { id: string }[]) => list.map((e) => e.id);

describe('filterEntries', () => {
	it('liefert ohne Filter alle Einträge', () => {
		expect(filterEntries(all, {})).toHaveLength(all.length);
		expect(filterEntries(all, { search: '   ', moduleId: null, method: null })).toHaveLength(
			all.length
		);
	});

	it('sucht case-insensitiv, mehrere Wörter UND-verknüpft', () => {
		expect(ids(filterEntries(all, { search: 'BENUTZER anlegen' }))).toEqual(['POST /api/v1/users']);
		expect(filterEntries(all, { search: 'benutzer xyz' })).toEqual([]);
	});

	it('durchsucht Pfad, Beschreibung, Berechtigung, Modulname und Methode', () => {
		expect(ids(filterEntries(all, { search: '/website/' }))).toEqual([
			'GET /api/v1/modules/events/website/events'
		]);
		expect(ids(filterEntries(all, { search: 'nur einmal' }))).toEqual(['POST /api/v1/api-keys']);
		expect(ids(filterEntries(all, { search: 'core.users.delete' }))).toEqual([
			'DELETE /api/v1/users/:id'
		]);
		expect(filterEntries(all, { search: 'galerien' })).toHaveLength(2);
		expect(filterEntries(all, { search: 'put termin' })).toHaveLength(1);
	});

	it('filtert nach Modul, Methode, Zugriff und erlaubt', () => {
		expect(filterEntries(all, { moduleId: 'events' })).toHaveLength(3);
		expect(filterEntries(all, { method: 'POST' })).toHaveLength(3);
		expect(ids(filterEntries(all, { access: 'public' }))).toEqual([
			'GET /api/v1/health',
			'POST /api/v1/modules/galleries/public/upload/:token'
		]);
		expect(ids(filterEntries(all, { access: 'authenticated' }))).toEqual(['GET /api/v1/me']);
		expect(ids(filterEntries(all, { access: 'session' }))).toEqual(['POST /api/v1/api-keys']);
		const allowed = filterEntries(all, { onlyAllowed: true });
		expect(allowed.every((e) => e.allowed)).toBe(true);
		expect(allowed).toHaveLength(all.length - 2);
		expect(
			ids(filterEntries(all, { moduleId: 'core', method: 'DELETE', onlyAllowed: true }))
		).toEqual([]);
	});
});

describe('groupEntries', () => {
	it('hält die Gruppenreihenfolge und sortiert nach Pfad, dann Methode', () => {
		const groups = groupEntries(sampleCatalog, all);
		expect(groups.map((g) => g.group.id)).toEqual([
			'System',
			'Benutzer',
			'module:events',
			'module:galleries'
		]);
		expect(ids(groups[1]!.entries)).toEqual([
			'GET /api/v1/users',
			'POST /api/v1/users',
			'GET /api/v1/users/:id',
			'DELETE /api/v1/users/:id'
		]);
	});

	it('lässt leere Gruppen weg und verändert die Eingabe nicht', () => {
		const input = filterEntries(all, { moduleId: 'events' });
		const before = ids(input);
		const groups = groupEntries(sampleCatalog, input);
		expect(groups.map((g) => g.group.id)).toEqual(['module:events']);
		expect(ids(input)).toEqual(before);
		expect(groupEntries(sampleCatalog, [])).toEqual([]);
	});
});

describe('Optionen', () => {
	it('moduleOptions: Core zuerst, dann Module in Gruppenreihenfolge, je einmal', () => {
		expect(moduleOptions(sampleCatalog)).toEqual([
			{ value: 'core', label: 'Core' },
			{ value: 'events', label: 'Termine' },
			{ value: 'galleries', label: 'Galerien' }
		]);
	});

	it('moduleOptions: Modulgruppe ohne Einträge erscheint trotzdem', () => {
		const catalog = {
			...sampleCatalog,
			groups: [...sampleCatalog.groups, { id: 'module:members', label: 'Mitglieder' }]
		};
		expect(moduleOptions(catalog).at(-1)).toEqual({ value: 'members', label: 'Mitglieder' });
	});

	it('Methoden und Zugriffsarten', () => {
		expect(METHOD_OPTIONS.map((o) => o.value)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
		expect(ACCESS_OPTIONS.map((o) => o.label)).toEqual([
			'Öffentlich',
			'Nur Anmeldung',
			'Mit Berechtigung',
			'Nur Session'
		]);
	});
});

describe('catalogStats', () => {
	it('zählt Gesamt, Methoden, öffentlich und erlaubt', () => {
		expect(catalogStats(all)).toEqual({
			total: 12,
			byMethod: { GET: 7, POST: 3, PUT: 1, PATCH: 0, DELETE: 1 },
			publicCount: 2,
			allowedCount: 10
		});
		expect(catalogStats([])).toEqual({
			total: 0,
			byMethod: { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 },
			publicCount: 0,
			allowedCount: 0
		});
	});
});

describe('Suchparameter', () => {
	it('liest gültige Werte', () => {
		const sp = new URLSearchParams(
			'q=termin+bearbeiten&module=events&method=put&access=session&allowed=1'
		);
		expect(filterFromSearchParams(sp)).toEqual({
			search: 'termin bearbeiten',
			moduleId: 'events',
			method: 'PUT',
			access: 'session',
			onlyAllowed: true
		});
	});

	it('ignoriert ungültige Werte', () => {
		const sp = new URLSearchParams('q=+&module=Foo_Bar&method=TRACE&access=admin&allowed=true');
		expect(filterFromSearchParams(sp)).toEqual({});
		expect(filterFromSearchParams(new URLSearchParams())).toEqual({});
	});

	it('schreibt nur gesetzte Werte und ist umkehrbar', () => {
		expect(filterToSearchParams({}).toString()).toBe('');
		expect(
			filterToSearchParams({
				search: '',
				moduleId: null,
				method: null,
				onlyAllowed: false
			}).toString()
		).toBe('');
		const f = {
			search: 'benutzer anlegen',
			moduleId: 'core',
			method: 'POST' as const,
			access: 'permission' as const,
			onlyAllowed: true
		};
		const sp = filterToSearchParams(f);
		expect(sp.get('allowed')).toBe('1');
		expect(filterFromSearchParams(sp)).toEqual(f);
	});
});
