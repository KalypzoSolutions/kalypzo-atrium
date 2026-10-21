import { describe, expect, it, vi } from 'vitest';
import {
	CLIENT_IP_HEADER,
	applyClientIpHeader,
	clientAddress,
	currentClientIp,
	withClientIp
} from '$lib/server/core/auth/client-ip';
import { maskEmailInput } from '$lib/server/core/auth/mask-email';
import { limitAuthAction, AUTH_RATE_LIMITS } from '$lib/server/core/auth/auth-limits';
import { resetAllForTests } from '$lib/server/core/rate-limit';
import { sanitizeMetadata } from '$lib/server/core/audit/service';

describe('Client-IP-Helfer (#42)', () => {
	it('verwirft einen vom Client gesetzten internen Header und setzt die Server-Adresse', () => {
		const h = new Headers({
			'x-forwarded-for': '203.0.113.7, 198.51.100.1',
			[CLIENT_IP_HEADER]: '6.6.6.6'
		});
		applyClientIpHeader(h, '10.0.0.5');
		expect(h.get(CLIENT_IP_HEADER)).toBe('10.0.0.5');
		applyClientIpHeader(h, null);
		expect(h.has(CLIENT_IP_HEADER)).toBe(false);
	});

	it('withClientIp verändert die Original-Header nicht', () => {
		const orig = new Headers({ [CLIENT_IP_HEADER]: '6.6.6.6' });
		const copy = withClientIp(orig, '10.0.0.6');
		expect(copy.get(CLIENT_IP_HEADER)).toBe('10.0.0.6');
		expect(orig.get(CLIENT_IP_HEADER)).toBe('6.6.6.6');
	});

	it('currentClientIp ohne Request-Kontext: nur der interne Header, nie X-Forwarded-For', () => {
		expect(currentClientIp(new Headers({ 'x-forwarded-for': '203.0.113.7' }))).toBeNull();
		expect(currentClientIp(new Headers({ [CLIENT_IP_HEADER]: '10.0.0.7' }))).toBe('10.0.0.7');
		expect(currentClientIp(null)).toBeNull();
	});

	it('clientAddress fängt Fehler ab', () => {
		expect(clientAddress({ getClientAddress: () => '10.0.0.8' })).toBe('10.0.0.8');
		expect(
			clientAddress({
				getClientAddress: () => {
					throw new Error('prerender');
				}
			})
		).toBeNull();
	});
});

describe('limitAuthAction (#14)', () => {
	it('zählt je IP und je Ziel; IP über dem Limit zählt das Ziel nicht mit', () => {
		resetAllForTests();
		const { max } = AUTH_RATE_LIMITS.passwordReset;
		for (let i = 0; i < max; i++) {
			expect(limitAuthAction('passwordReset', { ip: `1.1.1.${i}`, target: 'a@x.de' }).allowed).toBe(
				true
			);
		}
		expect(limitAuthAction('passwordReset', { ip: '1.1.1.99', target: 'a@x.de' }).allowed).toBe(
			false
		);
		expect(limitAuthAction('passwordReset', { ip: '1.1.1.99', target: 'b@x.de' }).allowed).toBe(
			true
		);
	});
});

describe('Login-Maskierung (#26)', () => {
	it('maskiert Adressen, Eingaben ohne @ werden „[ungültig]“', () => {
		expect(maskEmailInput(' Anna@Example.org ')).toBe('a***@example.org');
		expect(maskEmailInput('MeinGeheimesPasswort!')).toBe('[ungültig]');
		expect(maskEmailInput('')).toBe('[ungültig]');
		expect(maskEmailInput('a b@c')).toBe('[ungültig]');
	});
});

describe('sanitizeMetadata: Blockliste personenbezogener Felder (#26)', () => {
	it('entfernt bzw. maskiert, behält Zähler und Objektnamen, warnt im Log', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const out = sanitizeMetadata(
			{
				name: 'Sommerlager',
				email: 'anna@example.org',
				emailTo: 'b***@example.org',
				birthDate: '2014-01-02',
				iban: 'DE02120300000000202051',
				ibanChanged: true,
				emails: 2,
				nested: { contact: 'karl@example.org', lastName: 'Muster' }
			},
			0,
			'test.x.created'
		) as Record<string, unknown>;
		expect(out.name).toBe('Sommerlager');
		expect(out.email).toBe('a***@example.org');
		expect(out.emailTo).toBe('b***@example.org');
		expect(out.birthDate).toBe('[entfernt]');
		expect(out.iban).toBe('[entfernt]');
		expect(out.ibanChanged).toBe(true);
		expect(out.emails).toBe(2);
		expect(out.nested).toEqual({ contact: 'k***@example.org', lastName: '[entfernt]' });
		expect(warn).toHaveBeenCalled();
		expect(String(warn.mock.calls[0]![0])).toContain('test.x.created');
		warn.mockRestore();
	});
});
