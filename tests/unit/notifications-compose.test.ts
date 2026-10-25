import { describe, expect, it } from 'vitest';
import {
	PUSH_BODY_MAX,
	composeMail,
	composePush,
	oneLine,
	type ComposeItem
} from '$lib/server/core/notifications/compose';
import { allowedChannels } from '$lib/sdk/types/notifications';
import { validateDefinition } from '$lib/server/core/modules/registry';
import type { ModuleDefinition } from '$lib/server/core/modules/types';

const item = (title: string, extra: Partial<ComposeItem> = {}): ComposeItem => ({
	title,
	body: '',
	link: null,
	group: null,
	tag: 't',
	...extra
});

describe('composeMail', () => {
	it('eine Benachrichtigung: Betreff = Titel, Text ohne doppelten Titel', () => {
		const m = composeMail(
			'Anna',
			[item('Neue Bestellung', { body: 'Text', link: '/x' })],
			'immediate',
			'https://a.test'
		);
		expect(m.subject).toBe('Neue Bestellung');
		expect(m.text).toContain('Hallo Anna,');
		expect(m.text).toContain('https://a.test/x');
		expect(m.text.match(/Neue Bestellung/g)).toBeNull();
		expect(m.text).toContain('https://a.test/profile?tab=notifications');
	});

	it('mehrere: Sammelbetreff und Gruppen-Überschriften', () => {
		const m = composeMail(
			'Anna',
			[item('A', { group: 'Kasse' }), item('B', { group: 'Kämmerer*in' })],
			'immediate',
			'https://a.test'
		);
		expect(m.subject).toBe('2 neue Benachrichtigungen');
		expect(m.text).toContain('– Kasse –');
		expect(m.text).toContain('– Kämmerer*in –');
	});

	it('Tageszusammenfassung', () => {
		expect(composeMail('A', [item('x')], 'daily', 'https://a.test').subject).toBe(
			'Tageszusammenfassung: 1 Benachrichtigung'
		);
	});
});

describe('composePush', () => {
	it('kürzt den Text und nutzt den Link', () => {
		const [p] = composePush([item('T', { body: 'a\n'.repeat(400), link: '/m' })], 'immediate');
		expect(p!.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
		expect(p!.body).not.toContain('\n');
		expect(p!.url).toBe('/m');
	});

	it('ab vier Einträgen eine Sammelnachricht', () => {
		const list = ['a', 'b', 'c', 'd'].map((t) => item(t));
		const out = composePush(list, 'immediate');
		expect(out).toHaveLength(1);
		expect(out[0]!.title).toBe('4 neue Benachrichtigungen');
		expect(out[0]!.url).toBe('/dashboard');
		expect(composePush(list.slice(0, 3), 'immediate')).toHaveLength(3);
	});

	it('oneLine kürzt mit Auslassungszeichen', () => {
		expect(oneLine('  ab   cd  ', 10)).toBe('ab cd');
		expect(oneLine('abcdefghij', 5)).toBe('abcd…');
	});
});

describe('allowedChannels', () => {
	it('mandatory ohne Aus, pushOnly nur Aus/Push', () => {
		expect(allowedChannels({})).toEqual(['off', 'email', 'both', 'push']);
		expect(allowedChannels({ mandatory: true })).toEqual(['email', 'both', 'push']);
		expect(allowedChannels({ pushOnly: true })).toEqual(['off', 'push']);
	});
});

describe('Registry-Prüfung der Typen', () => {
	const def = (
		types: NonNullable<ModuleDefinition['notifications']>['types']
	): ModuleDefinition => ({
		manifest: {
			id: 'nottest',
			name: 'T',
			version: '1.0.0',
			dependencies: [],
			permissions: ['nottest.x.view'],
			navigation: []
		},
		notifications: { types }
	});
	it('wirft bei doppelten/ungültigen Schlüsseln, unzulässigem Standard und fremden Rechten', () => {
		expect(() => validateDefinition(def([{ key: 'a', label: 'A' }]))).not.toThrow();
		expect(() => validateDefinition(def([{ key: 'A_b', label: 'A' }]))).toThrow();
		expect(() =>
			validateDefinition(
				def([
					{ key: 'a', label: 'A' },
					{ key: 'a', label: 'B' }
				])
			)
		).toThrow();
		expect(() =>
			validateDefinition(def([{ key: 'a', label: 'A', mandatory: true, defaultChannel: 'off' }]))
		).toThrow();
		expect(() =>
			validateDefinition(def([{ key: 'a', label: 'A', pushOnly: true, defaultChannel: 'email' }]))
		).toThrow();
		expect(() =>
			validateDefinition(def([{ key: 'a', label: 'A', permission: 'other.x.view' }]))
		).toThrow();
	});
});
