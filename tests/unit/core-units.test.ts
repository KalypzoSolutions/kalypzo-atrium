import { beforeEach, describe, expect, it } from 'vitest';
import {
	decryptSecret,
	encryptSecret,
	isEncrypted,
	safeEqual,
	sha256
} from '$lib/server/core/crypto';
import { hit, peek, reset, resetAllForTests } from '$lib/server/core/rate-limit';
import { sanitizeMetadata } from '$lib/server/core/audit/service';
import {
	assertDependenciesResolvable,
	registerModule,
	unregisterModule,
	validateDefinition
} from '$lib/server/core/modules/registry';
import { assertCanGrant, assertPermissionKey, has } from '$lib/server/core/permissions/service';
import { CORE_PERMISSIONS, PERMISSION_PATTERN } from '$lib/server/core/permissions/catalog';
import { CORE_SETTINGS } from '$lib/server/core/settings/catalog';
import {
	matchEndpoint,
	registerCoreEndpoints,
	resetCoreEndpointsForTests
} from '$lib/server/core/api/registry';
import type { ModuleDefinition } from '$lib/server/core/modules/types';
import type { RequestContext } from '$lib/sdk/types';

const ctx = (perms: string[], type: 'user' | 'system' = 'user'): RequestContext => ({
	actor: { type, id: 'u1', name: 'u1' },
	userId: 'u1',
	permissions: new Set(perms),
	ip: null,
	requestId: 'r'
});

const mod = (id: string, over: Partial<ModuleDefinition['manifest']> = {}): ModuleDefinition => ({
	manifest: {
		id,
		name: id,
		version: '1.0.0',
		dependencies: [],
		permissions: [],
		navigation: [],
		...over
	}
});

describe('crypto', () => {
	it('verschlüsselt und entschlüsselt Secrets (zufällige IV)', () => {
		const a = encryptSecret('hallo');
		const b = encryptSecret('hallo');
		expect(a).not.toEqual(b);
		expect(isEncrypted(a)).toBe(true);
		expect(decryptSecret(a)).toBe('hallo');
	});
	it('erkennt manipulierte Chiffrate', () => {
		const enc = encryptSecret('x');
		expect(() => decryptSecret(enc.slice(0, -2) + 'AA')).toThrow();
	});
	it('hasht und vergleicht in konstanter Zeit', () => {
		expect(sha256('a')).toHaveLength(64);
		expect(safeEqual('abc', 'abc')).toBe(true);
		expect(safeEqual('abc', 'abd')).toBe(false);
	});
});

describe('rate-limit', () => {
	beforeEach(() => resetAllForTests());
	it('blockiert nach dem Limit und meldet retryAfter', () => {
		for (let i = 0; i < 3; i++) expect(hit('k', 3, 60).allowed).toBe(true);
		const r = hit('k', 3, 60);
		expect(r.allowed).toBe(false);
		expect(r.retryAfterSec).toBeGreaterThan(0);
		expect(peek('k', 60)).toBe(3);
		reset('k');
		expect(hit('k', 3, 60).allowed).toBe(true);
	});
});

describe('audit sanitize', () => {
	it('entfernt Secrets, kürzt lange Strings und begrenzt Tiefe', () => {
		const out = sanitizeMetadata({
			password: 'p',
			token: 't',
			Authorization: 'Bearer x',
			long: 'a'.repeat(2000),
			deep: { a: { b: { c: { d: { e: 1 } } } } }
		}) as Record<string, unknown>;
		expect(out.password).toBe('[redacted]');
		expect(out.token).toBe('[redacted]');
		expect(out.Authorization).toBe('[redacted]');
		expect((out.long as string).length).toBeLessThan(600);
		expect(JSON.stringify(out.deep)).toContain('[truncated]');
	});
});

describe('Berechtigungen', () => {
	it('Schema modul.ressource.aktion', () => {
		expect(PERMISSION_PATTERN.test('core.users.view')).toBe(true);
		expect(PERMISSION_PATTERN.test('core.users')).toBe(false);
		expect(PERMISSION_PATTERN.test('Core.Users.View')).toBe(false);
		expect(() => assertPermissionKey('kaputt')).toThrow();
		for (const k of Object.keys(CORE_PERMISSIONS)) expect(PERMISSION_PATTERN.test(k)).toBe(true);
	});
	it('has() und assertCanGrant()', () => {
		expect(has(ctx(['a.b.c']), 'a.b.c')).toBe(true);
		expect(has(ctx([]), 'a.b.c')).toBe(false);
		expect(has(ctx([], 'system'), 'a.b.c')).toBe(true);
		expect(() => assertCanGrant(ctx(['a.b.c']), ['a.b.c'])).not.toThrow();
		expect(() => assertCanGrant(ctx(['a.b.c']), ['a.b.c', 'x.y.z'])).toThrow(/Rechteausweitung/);
	});
});

describe('Modulregistrierung', () => {
	it('validiert IDs, Versionen, Berechtigungs-Präfix und Navigationspfade', () => {
		expect(() => validateDefinition(mod('core'))).toThrow();
		expect(() => validateDefinition(mod('Bad ID'))).toThrow();
		expect(() => validateDefinition(mod('ok', { version: 'x' }))).toThrow();
		expect(() => validateDefinition(mod('ok', { permissions: ['other.items.view'] }))).toThrow();
		expect(() =>
			validateDefinition(mod('ok', { navigation: [{ label: 'x', icon: 'a', path: '/admin' }] }))
		).toThrow();
		expect(() =>
			validateDefinition(
				mod('ok', {
					permissions: ['ok.items.view'],
					navigation: [{ label: 'x', icon: 'a', path: '/modules/ok' }]
				})
			)
		).not.toThrow();
	});
	it('erkennt fehlende Abhängigkeiten und Zyklen', () => {
		registerModule(mod('zz-a', { dependencies: ['zz-b'] }));
		expect(() => assertDependenciesResolvable()).toThrow(/unbekanntes Modul/);
		registerModule(mod('zz-b', { dependencies: ['zz-a'] }));
		expect(() => assertDependenciesResolvable()).toThrow(/Zyklische/);
		unregisterModule('zz-a');
		unregisterModule('zz-b');
	});
	it('lehnt doppelte Registrierung ab', () => {
		registerModule(mod('zz-dup'));
		expect(() => registerModule(mod('zz-dup'))).toThrow(/bereits/);
		unregisterModule('zz-dup');
	});
});

describe('Einstellungskatalog', () => {
	it('Schlüssel eindeutig, Defaults gültig, Secrets ohne Klartext-Default', () => {
		const keys = CORE_SETTINGS.map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const s of CORE_SETTINGS) {
			expect(s.key.startsWith('core.')).toBe(true);
			if (s.default !== undefined) {
				expect(s.schema.safeParse(s.default).success, s.key).toBe(true);
			}
			if (s.secret) expect(s.default).toBe('');
		}
	});
});

describe('Endpunkt-Matching', () => {
	it('findet Pfade mit Parametern und unterscheidet Methoden', () => {
		resetCoreEndpointsForTests();
		registerCoreEndpoints([
			{ method: 'GET', path: '/things/:id', summary: 's', permission: null, handler: () => null },
			{ method: 'DELETE', path: '/things/:id', summary: 's', permission: null, handler: () => null }
		]);
		const m = matchEndpoint('GET', '/things/abc%20d');
		expect(m.match?.params.id).toBe('abc d');
		const wrongMethod = matchEndpoint('POST', '/things/1');
		expect(wrongMethod.pathExists).toBe(true);
		expect(wrongMethod.match).toBeUndefined();
		expect(matchEndpoint('GET', '/nope').pathExists).toBe(false);
		resetCoreEndpointsForTests();
	});
});
