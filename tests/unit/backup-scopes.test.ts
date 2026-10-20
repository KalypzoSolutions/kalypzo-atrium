import { describe, expect, it } from 'vitest';
import { moduleInsertOrder, resolveScopes } from '$lib/server/core/backup/scopes';
import type { BackupScopeInfo } from '$lib/server/core/backup/types';

const scope = (
	key: string,
	implies: { scope: string; reason: string }[] = []
): BackupScopeInfo => ({
	key,
	group: key.startsWith('core:') ? 'core' : 'module',
	label: key,
	description: '',
	implies,
	enabled: true
});

const ALL = [
	scope('core:users', [{ scope: 'core:api-keys', reason: 'API-Keys gehören zu Benutzerkonten' }]),
	scope('core:roles'),
	scope('core:api-keys'),
	scope('core:settings'),
	scope('members'),
	scope('actions')
];

describe('resolveScopes', () => {
	it('ergänzt implizierte Bereiche mit Begründung', () => {
		const r = resolveScopes(['core:users'], ALL);
		expect(r.scopes).toEqual(['core:users', 'core:api-keys']);
		expect(r.implied).toEqual([
			{ scope: 'core:api-keys', by: 'core:users', reason: 'API-Keys gehören zu Benutzerkonten' }
		]);
		expect(r.unknown).toEqual([]);
	});

	it('meldet ausdrücklich gewählte Bereiche nicht als impliziert', () => {
		const r = resolveScopes(['core:api-keys', 'core:users'], ALL);
		expect(r.scopes).toEqual(['core:users', 'core:api-keys']);
		expect(r.implied).toEqual([]);
	});

	it('sortiert nach dem Katalog und entfernt Duplikate', () => {
		const r = resolveScopes(['actions', 'core:settings', 'actions', 'members'], ALL);
		expect(r.scopes).toEqual(['core:settings', 'members', 'actions']);
	});

	it('impliziert keine Modul-Abhängigkeiten', () => {
		expect(resolveScopes(['actions'], ALL).scopes).toEqual(['actions']);
	});

	it('meldet unbekannte Bereiche', () => {
		const r = resolveScopes(['core:foo', 'galleries', 'core:roles'], ALL);
		expect(r.unknown).toEqual(['core:foo', 'galleries']);
		expect(r.scopes).toEqual(['core:roles']);
	});

	it('löst Implikationen transitiv auf (auch bei Zyklen)', () => {
		const all = [
			scope('a', [{ scope: 'b', reason: 'x' }]),
			scope('b', [{ scope: 'c', reason: 'y' }]),
			scope('c', [{ scope: 'a', reason: 'z' }])
		];
		const r = resolveScopes(['a'], all);
		expect(r.scopes).toEqual(['a', 'b', 'c']);
		expect(r.implied.map((i) => `${i.scope}<${i.by}`)).toEqual(['b<a', 'c<b']);
	});
});

describe('moduleInsertOrder', () => {
	it('stellt Abhängigkeiten zuerst, sonst alphabetisch', () => {
		expect(
			moduleInsertOrder([
				{ id: 'treasury', deps: ['actions', 'members', 'offices'] },
				{ id: 'actions', deps: ['members'] },
				{ id: 'members', deps: [] },
				{ id: 'events', deps: ['members'] }
			])
		).toEqual(['members', 'actions', 'events', 'treasury']);
	});

	it('ignoriert fehlende Abhängigkeiten und übersteht Zyklen', () => {
		expect(
			moduleInsertOrder([
				{ id: 'a', deps: ['b', 'nope'] },
				{ id: 'b', deps: ['a'] }
			])
		).toEqual(['b', 'a']);
	});
});
