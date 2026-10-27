import { describe, expect, it } from 'vitest';
import { areaForPath, visibleAreas } from '$lib/modules/material/pages/nav';

describe('Bereiche Material', () => {
	it('nur Lesen: Ausleihen, Scannen, Lager', () => {
		expect(visibleAreas(['material.inventory.view']).map((a) => a.area)).toEqual([
			'borrow',
			'scan',
			'stock'
		]);
	});

	it('Reservieren ohne Verwaltung: zusätzlich Meine Reservierungen, kein Ausgabe/Etiketten', () => {
		expect(
			visibleAreas(['material.inventory.view', 'material.reservation.create']).map((a) => a.area)
		).toEqual(['borrow', 'mine', 'scan', 'stock']);
	});

	it('Materialwart*in sieht alles', () => {
		expect(
			visibleAreas([
				'material.inventory.view',
				'material.inventory.manage',
				'material.reservation.create',
				'material.reservation.manage',
				'material.labels.manage'
			]).map((a) => a.area)
		).toEqual(['borrow', 'mine', 'scan', 'stock', 'handout', 'labels']);
	});

	it('aktiver Bereich aus dem Pfad', () => {
		expect(areaForPath('/modules/material')).toBe('borrow');
		expect(areaForPath('/modules/material/lager')).toBe('stock');
		expect(areaForPath('/modules/material/scan/M-000001')).toBe('scan');
		expect(areaForPath('/modules/material/labels/new')).toBe('labels');
		expect(areaForPath('/modules/material/reservierung/x')).toBe('mine');
	});
});
