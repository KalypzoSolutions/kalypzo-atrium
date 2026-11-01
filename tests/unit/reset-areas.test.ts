import { describe, expect, it } from 'vitest';
import {
	rebuildReason,
	areasFingerprint,
	effectiveImplies,
	moduleDeleteOrder,
	resolveAreas,
	type AreaNode
} from '$lib/server/core/system/reset-areas';

const node = (
	key: string,
	implies: { area: string; reason: string }[] = [],
	rebuild = false
): AreaNode => ({ key, module: key.split(':')[0]!, rebuild, implies });

const nodes: AreaNode[] = [
	node('treasury:bookings'),
	node('actions:accounting', [{ area: 'treasury:bookings', reason: 'Belege' }]),
	node('actions:all', [], true),
	node('members:all', [
		{ area: 'actions:accounting', reason: 'Teilnehmende' },
		{ area: 'ghost:x', reason: 'inaktives Modul' }
	]),
	node('core:users', [{ area: 'core:api-keys', reason: 'Keys' }]),
	node('core:api-keys'),
	node('core:audit')
];

describe('resolveAreas', () => {
	it('liefert nur die Auswahl, wenn nichts impliziert wird', () => {
		const r = resolveAreas(['core:audit'], nodes);
		expect(r.areas).toEqual(['core:audit']);
		expect(r.implied).toEqual([]);
		expect(r.unknown).toEqual([]);
	});

	it('löst Implikationen transitiv auf und ignoriert unbekannte Ziele', () => {
		const r = resolveAreas(['members:all'], nodes);
		expect(r.areas).toEqual(['treasury:bookings', 'actions:accounting', 'members:all']);
		expect(r.implied).toEqual([
			{ area: 'actions:accounting', by: 'members:all', reason: 'Teilnehmende' },
			{ area: 'treasury:bookings', by: 'actions:accounting', reason: 'Belege' }
		]);
	});

	it('rebuild schließt alle Bereiche des Moduls (und deren Implikationen) ein', () => {
		const r = resolveAreas(['actions:all'], nodes);
		expect(r.areas).toEqual(['treasury:bookings', 'actions:accounting', 'actions:all']);
		expect(r.implied[0]).toEqual({
			area: 'actions:accounting',
			by: 'actions:all',
			reason: rebuildReason()
		});
	});

	it('meldet unbekannte Schlüssel und führt Doppelte nur einmal', () => {
		const r = resolveAreas(['core:users', 'core:users', 'foo:bar'], nodes);
		expect(r.unknown).toEqual(['foo:bar']);
		expect(r.areas).toEqual(['core:users', 'core:api-keys']);
		expect(r.implied).toHaveLength(1);
	});

	it('bereits ausgewählte Bereiche erscheinen nicht als impliziert', () => {
		const r = resolveAreas(['core:users', 'core:api-keys'], nodes);
		expect(r.implied).toEqual([]);
	});

	it('kommt mit Zyklen zurecht', () => {
		const cyc = [
			node('a:x', [{ area: 'b:y', reason: '1' }]),
			node('b:y', [{ area: 'a:x', reason: '2' }])
		];
		expect(resolveAreas(['a:x'], cyc).areas).toEqual(['a:x', 'b:y']);
	});
});

describe('effectiveImplies', () => {
	it('filtert Selbstbezug und unbekannte Bereiche', () => {
		const n = node('m:a', [
			{ area: 'm:a', reason: 'selbst' },
			{ area: 'zz:q', reason: 'weg' }
		]);
		expect(effectiveImplies(n, [n])).toEqual([]);
	});
});

describe('moduleDeleteOrder', () => {
	it('abhängige Module zuerst', () => {
		expect(
			moduleDeleteOrder([
				{ id: 'members', deps: [] },
				{ id: 'treasury', deps: ['members', 'actions'] },
				{ id: 'actions', deps: ['members'] }
			])
		).toEqual(['treasury', 'actions', 'members']);
	});

	it('ignoriert unbekannte (inaktive) Abhängigkeiten', () => {
		expect(
			moduleDeleteOrder([
				{ id: 'b', deps: ['ghost'] },
				{ id: 'a', deps: [] }
			])
		).toEqual(['b', 'a']);
	});
});

describe('areasFingerprint', () => {
	it('ist unabhängig von Reihenfolge und Doppelten', () => {
		expect(areasFingerprint(['b', 'a', 'a'])).toBe(areasFingerprint(['a', 'b']));
		expect(areasFingerprint(['a'])).not.toBe(areasFingerprint(['a', 'b']));
	});
});
