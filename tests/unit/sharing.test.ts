import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { principalMatchSql } from '$lib/sdk/server/sharing';
import { EVERYONE_ID, parsePrincipalKey, principalKey } from '$lib/sdk/types/sharing';

const dialect = new PgDialect();
const render = (alias: string, keys: string[]) =>
	dialect.sqlToQuery(principalMatchSql(alias, keys));

describe('principalMatchSql', () => {
	it('leere Schlüsselliste ergibt FALSE ohne Parameter', () => {
		const q = render('s', []);
		expect(q.sql).toBe('FALSE');
		expect(q.params).toEqual([]);
	});

	it('parametrisiert die Schlüssel und nutzt den Alias', () => {
		const q = render('es', ['everyone:*', 'user:u1', "role:x' OR 1=1 --"]);
		expect(q.sql).toBe("((es.principal_type || ':' || es.principal_id) IN ($1, $2, $3))");
		expect(q.params).toEqual(['everyone:*', 'user:u1', "role:x' OR 1=1 --"]);
	});

	it.each(['', 'S', '1s', 's.x', 's;drop', 'a b', 'shares"', 'ä'])(
		'lehnt ungültigen Alias %j ab',
		(alias) => {
			expect(() => principalMatchSql(alias, ['everyone:*'])).toThrow();
			expect(() => principalMatchSql(alias, [])).toThrow();
		}
	);

	it('akzeptiert einfache Bezeichner', () => {
		for (const alias of ['s', '_x', 'event_shares', 'e2']) {
			expect(() => principalMatchSql(alias, ['user:a'])).not.toThrow();
		}
	});
});

describe('principalKey / parsePrincipalKey', () => {
	it('bildet typ:id', () => {
		expect(principalKey({ type: 'group', id: 'abc' })).toBe('group:abc');
		expect(principalKey({ type: 'everyone', id: EVERYONE_ID })).toBe('everyone:*');
	});

	it('parst gültige Schlüssel (ID darf Doppelpunkte enthalten)', () => {
		expect(parsePrincipalKey('user:u1')).toEqual({ type: 'user', id: 'u1' });
		expect(parsePrincipalKey('everyone:*')).toEqual({ type: 'everyone', id: '*' });
		expect(parsePrincipalKey('member:a:b')).toEqual({ type: 'member', id: 'a:b' });
	});

	it('lehnt ungültige Schlüssel ab', () => {
		for (const k of ['', 'user', 'user:', ':abc', 'foo:abc', 'USER:abc']) {
			expect(parsePrincipalKey(k)).toBeNull();
		}
	});

	it('Hin- und Rückweg sind verlustfrei', () => {
		for (const p of [
			{ type: 'role', id: 'r-1' },
			{ type: 'member', id: crypto.randomUUID() }
		] as const) {
			expect(parsePrincipalKey(principalKey(p))).toEqual(p);
		}
	});
});
