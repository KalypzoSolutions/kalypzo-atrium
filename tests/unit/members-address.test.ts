import { describe, expect, it } from 'vitest';
import { memberInput } from '$lib/modules/members/schemas';
import { placesForPostalCode, toSuggestion } from '$lib/modules/members/address.service';
import { countryOptions } from '$lib/modules/members/pages/countries';

const base = {
	firstName: 'Max',
	lastName: 'Muster',
	birthDate: '2012-05-17',
	street: 'Musterweg 1',
	postalCode: '28357',
	city: 'Bremen',
	stage: 'pfadfinder'
};

describe('Anschrift im Mitglied', () => {
	it('Land ist standardmäßig Deutschland, Kürzel wird groß geschrieben', () => {
		expect(memberInput.parse(base).country).toBe('DE');
		expect(memberInput.parse({ ...base, country: 'at', postalCode: '1010' }).country).toBe('AT');
	});

	it('deutsche PLZ hat genau 5 Ziffern, Ausland freier', () => {
		expect(memberInput.safeParse({ ...base, postalCode: '2835' }).success).toBe(false);
		expect(memberInput.safeParse({ ...base, postalCode: '28 357' }).success).toBe(false);
		expect(memberInput.safeParse({ ...base, country: 'GB', postalCode: 'SW1A 1AA' }).success).toBe(
			true
		);
		expect(memberInput.safeParse({ ...base, country: 'AT', postalCode: '<x>' }).success).toBe(
			false
		);
	});

	it('Straße, PLZ, Ort sind Pflicht; ungültiges Land wird abgelehnt', () => {
		for (const k of ['street', 'postalCode', 'city']) {
			expect(memberInput.safeParse({ ...base, [k]: '  ' }).success, k).toBe(false);
		}
		expect(memberInput.safeParse({ ...base, country: 'Deutschland' }).success).toBe(false);
	});
});

describe('Photon → Adressvorschlag', () => {
	it('baut Straße + Nr., PLZ, Ort, Land', () => {
		expect(
			toSuggestion({
				street: 'Rockwinkler Heerstraße',
				housenumber: '140',
				postcode: '28355',
				city: 'Bremen',
				countrycode: 'DE'
			})
		).toEqual({
			label: 'Rockwinkler Heerstraße 140, 28355 Bremen',
			street: 'Rockwinkler Heerstraße 140',
			postalCode: '28355',
			city: 'Bremen',
			country: 'DE'
		});
	});

	it('Straßentreffer ohne Hausnummer; Ort aus town/village', () => {
		const s = toSuggestion({
			name: 'Hauptstraße',
			osm_key: 'highway',
			postcode: '37308',
			village: 'Krombach',
			countrycode: 'de'
		});
		expect(s?.street).toBe('Hauptstraße');
		expect(s?.city).toBe('Krombach');
		expect(s?.country).toBe('DE');
	});

	it('verwirft Treffer ohne Straße oder ohne PLZ und Ort', () => {
		expect(toSuggestion({ name: 'Bremen', osm_key: 'place', postcode: '28195' })).toBeNull();
		expect(toSuggestion({ street: 'Weg', countrycode: 'DE' })).toBeNull();
		expect(toSuggestion({ street: 'Weg', city: 'X', countrycode: 'Deutschland' })).toBeNull();
	});
});

describe('PLZ → Ort (offline)', () => {
	it('kennt gängige Postleitzahlen', () => {
		expect(placesForPostalCode('28207')).toContain('Bremen');
		expect(placesForPostalCode('10115')).toContain('Berlin');
		expect(placesForPostalCode('80331')).toContain('München');
		expect(placesForPostalCode('00000')).toEqual([]);
	});
});

describe('Länderliste', () => {
	it('Deutschland zuerst, unbekannte Codes werden ergänzt', () => {
		const o = countryOptions('BS');
		expect(o[0]).toEqual({ value: 'DE', label: 'Deutschland' });
		expect(o.some((c) => c.value === 'BS')).toBe(true);
		expect(o.some((c) => c.value === 'AT' && c.label === 'Österreich')).toBe(true);
	});
});
