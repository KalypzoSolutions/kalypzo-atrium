import { describe, expect, it } from 'vitest';
import {
	blockedUnits,
	daysOf,
	freeQuantity,
	freeUnitCount,
	overlaps,
	type Booking
} from '$lib/modules/material/availability';
import { allocate, completeness, type Candidate } from '$lib/modules/material/allocation';
import {
	descendants,
	effectivePlace,
	locationPaths,
	wouldCycle
} from '$lib/modules/material/places';
import { codeFromScan, normalizeCode, scanPath } from '$lib/modules/material/schemas';

const booking = (
	id: string,
	startsOn: string,
	endsOn: string,
	unitIds: string[] = [],
	counts: Record<string, number> = {}
): Booking => ({
	reservationId: id,
	startsOn,
	endsOn,
	unitIds,
	counts: new Map(Object.entries(counts))
});

describe('Verfügbarkeit', () => {
	it('Überschneidung inklusive Grenzen', () => {
		expect(overlaps('2026-07-01', '2026-07-05', '2026-07-05', '2026-07-06')).toBe(true);
		expect(overlaps('2026-07-01', '2026-07-04', '2026-07-05', '2026-07-06')).toBe(false);
		expect(daysOf('2026-02-27', '2026-03-01')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
	});

	it('konkret belegte Stücke nur im Zeitraum', () => {
		const b = [
			booking('a', '2026-07-01', '2026-07-05', ['u1']),
			booking('b', '2026-08-01', '2026-08-02', ['u2'])
		];
		expect([...blockedUnits(b, '2026-07-04', '2026-07-10').keys()]).toEqual(['u1']);
	});

	it('Anzahl je Tag: zwei Reservierungen ohne gemeinsamen Tag addieren sich nicht', () => {
		const usable = ['1', '2', '3', '4', '5', '6', '7', '8'];
		const b = [
			booking('a', '2026-07-01', '2026-07-03', [], { bahn: 6 }),
			booking('b', '2026-07-04', '2026-07-06', [], { bahn: 6 })
		];
		// 1.–6.7.: an jedem Tag 6 belegt → 2 frei (nicht 8 − 12)
		expect(freeUnitCount(usable, 'bahn', b, '2026-07-01', '2026-07-06')).toBe(2);
		// konkrete Belegung und Anzahl am selben Tag
		const c = [booking('c', '2026-07-02', '2026-07-02', ['1', '2'], { bahn: 3 })];
		expect(freeUnitCount(usable, 'bahn', c, '2026-07-01', '2026-07-03')).toBe(3);
		// eigene konkrete Stücke zählen nicht als frei
		expect(freeUnitCount(usable, 'bahn', [], '2026-07-01', '2026-07-01', new Set(['1']))).toBe(7);
		// nie negativ
		expect(
			freeUnitCount(
				['1'],
				'bahn',
				[booking('d', '2026-07-01', '2026-07-01', [], { bahn: 5 })],
				'2026-07-01',
				'2026-07-01'
			)
		).toBe(0);
	});

	it('Mengen je Tag', () => {
		const b = [
			booking('a', '2026-07-01', '2026-07-02', [], { tasse: 10 }),
			booking('b', '2026-07-02', '2026-07-03', [], { tasse: 5 })
		];
		expect(freeQuantity(20, 'tasse', b, '2026-07-01', '2026-07-03')).toBe(5);
		expect(freeQuantity(20, 'tasse', b, '2026-07-03', '2026-07-03')).toBe(15);
		expect(freeQuantity(20, 'tasse', [], '2026-07-03', '2026-07-03')).toBe(20);
	});
});

describe('Zuteilung (Bahnen-Anfrage)', () => {
	const set = (setId: string, n: number, size = n): Candidate[] =>
		Array.from({ length: n }, (_, i) => ({
			unitId: `${setId}-${i}`,
			setId,
			setName: setId,
			setSize: size
		}));
	const loose = (n: number): Candidate[] =>
		Array.from({ length: n }, (_, i) => ({
			unitId: `lose-${i}`,
			setId: null,
			setName: null,
			setSize: 0
		}));

	it('ganze Sets zuerst, dann lose – kein Set aufgeteilt', () => {
		const r = allocate([...set('Kohte 1', 4), ...set('Kohte 2', 4), ...loose(2)], 6);
		expect(r.unitIds.filter((u) => u.startsWith('Kohte 1'))).toHaveLength(4);
		expect(r.unitIds.filter((u) => u.startsWith('lose'))).toHaveLength(2);
		expect(r.splitSets).toEqual([]);
		expect(r.missing).toBe(0);
	});

	it('muss aufteilen: bevorzugt ohnehin unvollständige Sets', () => {
		const r = allocate([...set('Kohte 1', 4), ...set('Kohte 2', 3, 4)], 2);
		expect(r.splitSets).toEqual(['Kohte 2']);
		expect(r.unitIds.every((u) => u.startsWith('Kohte 2'))).toBe(true);
	});

	it('zu wenig Stücke → Fehlmenge', () => {
		const r = allocate(loose(3), 5);
		expect(r.unitIds).toHaveLength(3);
		expect(r.missing).toBe(2);
	});
});

describe('Set-Vollständigkeit', () => {
	it('fehlend, zu viel, defekt', () => {
		const parts = [
			{ articleId: 'bahn', articleName: 'Kohtenbahn', quantity: 4 },
			{ articleId: 'kreuz', articleName: 'Kohtenkreuz', quantity: 1 }
		];
		const u = (articleId: string, usable = true) => ({ articleId, articleName: articleId, usable });
		const r = completeness(parts, [u('bahn'), u('bahn'), u('bahn'), u('bahn', false), u('stange')]);
		expect(r.complete).toBe(false);
		expect(r.missing).toEqual([
			{ articleId: 'bahn', articleName: 'Kohtenbahn', count: 1 },
			{ articleId: 'kreuz', articleName: 'Kohtenkreuz', count: 1 }
		]);
		expect(r.extra).toEqual([{ articleId: 'stange', articleName: 'stange', count: 1 }]);
		expect(r.unusable).toBe(1);
	});
});

describe('Orte und Kisten', () => {
	it('Pfade, Zyklen, Nachfahren', () => {
		const nodes = [
			{ id: 'a', parentId: null, name: 'Materialraum' },
			{ id: 'b', parentId: 'a', name: 'Regal A' },
			{ id: 'c', parentId: 'b', name: 'Fach 2' }
		];
		expect(locationPaths(nodes).get('c')).toBe('Materialraum › Regal A › Fach 2');
		const parents = new Map(nodes.map((n) => [n.id, n.parentId]));
		expect(wouldCycle(parents, 'a', 'c')).toBe(true);
		expect(wouldCycle(parents, 'c', 'a')).toBe(false);
		expect([...descendants(parents, 'a')].sort()).toEqual(['b', 'c']);
	});

	it('effektiver Ort über verschachtelte Kisten', () => {
		const byId = new Map([
			['anh', { id: 'anh', containerId: null, locationId: 'hof' }],
			['kiste', { id: 'kiste', containerId: 'anh', locationId: null }],
			['topf', { id: 'topf', containerId: 'kiste', locationId: null }]
		]);
		expect(effectivePlace(byId, 'topf')).toEqual({ locationId: 'hof', chain: ['kiste', 'anh'] });
	});
});

describe('Codes', () => {
	it('normalisiert und liest Scan-URLs', () => {
		expect(normalizeCode(' m-000 12 ')).toBe('M-00012');
		expect(codeFromScan(`https://intern.example.org${scanPath('M-000123')}`)).toBe('M-000123');
		expect(codeFromScan('https://example.org/anderes')).toBeNull();
		expect(codeFromScan('kk-1')).toBe('KK-1');
		expect(codeFromScan('')).toBeNull();
	});
});
