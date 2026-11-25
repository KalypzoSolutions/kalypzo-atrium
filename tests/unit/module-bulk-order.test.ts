/**
 * Reihenfolge der Sammelaktionen (`core/modules/bulk.ts`): Abhängigkeiten zuerst aktivieren, abhängige Module zuerst
 * deaktivieren, fehlende Abhängigkeiten transitiv ermitteln.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureLocale, tl } from '$lib/i18n';
import {
	missingDependencies,
	orderForDisable,
	orderForEnable
} from '$lib/server/core/modules/bulk';

// a → b → c (a braucht b, b braucht c), d ohne Abhängigkeiten, x ⇄ y (Zyklus)
const GRAPH: Record<string, string[]> = { a: ['b'], b: ['c'], c: [], d: [], x: ['y'], y: ['x'] };
const deps = (id: string) => GRAPH[id] ?? [];

describe('orderForEnable', () => {
	it('stellt Abhängigkeiten vor die Module, die sie brauchen', () => {
		expect(orderForEnable(['a', 'b', 'c'], deps)).toEqual(['c', 'b', 'a']);
	});

	it('gilt auch über nicht ausgewählte Zwischenglieder', () => {
		expect(orderForEnable(['a', 'c'], deps)).toEqual(['c', 'a']);
	});

	it('behält die Eingabereihenfolge für Unabhängige', () => {
		expect(orderForEnable(['d', 'c'], deps)).toEqual(['d', 'c']);
	});

	it('bricht bei Zyklen nicht ab und liefert jede ID genau einmal', () => {
		const r = orderForEnable(['x', 'y', 'x'], deps);
		expect([...r].sort()).toEqual(['x', 'y']);
	});
});

describe('orderForDisable', () => {
	it('deaktiviert abhängige Module zuerst', () => {
		expect(orderForDisable(['c', 'b', 'a'], deps)).toEqual(['a', 'b', 'c']);
	});
});

describe('missingDependencies', () => {
	it('liefert transitive, verfügbare Abhängigkeiten außerhalb der Auswahl', () => {
		expect(missingDependencies(['a'], deps, () => true)).toEqual(['b', 'c']);
	});

	it('überspringt nicht verfügbare (aktive oder nicht installierte) Abhängigkeiten', () => {
		expect(missingDependencies(['a'], deps, (id) => id !== 'b')).toEqual([]);
		expect(missingDependencies(['a'], deps, (id) => id !== 'c')).toEqual(['b']);
	});

	it('meldet ausgewählte Module nicht als zusätzlich', () => {
		expect(missingDependencies(['a', 'b'], deps, () => true)).toEqual(['c']);
	});
});

describe('Sammelmeldung', () => {
	beforeAll(() => ensureLocale('en'));

	it('lässt leere Teile weg', () => {
		expect(tl('de', 'modules.bulk.summary', { ok: 2, skipped: 0, failed: 1 })).toBe(
			'2 Module geändert, 1 fehlgeschlagen'
		);
		expect(tl('en', 'modules.bulk.summary', { ok: 0, skipped: 1, failed: 0 })).toBe(
			'No change, 1 unchanged'
		);
	});
});
