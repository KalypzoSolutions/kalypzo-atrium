import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { inList, num, resultRows, str, toIso, toIsoOrNull } from '$lib/server/core/database/rows';

describe('toIso / toIsoOrNull (#70, 04-05)', () => {
	it('Date (pg-Treiber) behält die Millisekunden', () => {
		expect(toIso(new Date('2026-10-20T12:34:56.345Z'))).toBe('2026-10-20T12:34:56.345Z');
	});
	it('ISO-String und PGlite-Format', () => {
		expect(toIso('2026-10-20T12:34:56.345Z')).toBe('2026-10-20T12:34:56.345Z');
		expect(toIso('2026-10-20 12:34:56.345+00')).toBe('2026-10-20T12:34:56.345Z');
		expect(toIso('2026-10-20 14:34:56.345+02')).toBe('2026-10-20T12:34:56.345Z');
	});
	it('nicht lesbare Werte kommen unverändert zurück (kein Wurf)', () => {
		expect(toIso('kaputt')).toBe('kaputt');
	});
	it('null/undefined', () => {
		expect(toIsoOrNull(null)).toBeNull();
		expect(toIsoOrNull(undefined)).toBeNull();
		expect(toIsoOrNull(new Date('2026-01-01T00:00:00.001Z'))).toBe('2026-01-01T00:00:00.001Z');
	});
});

describe('inList', () => {
	const dialect = new PgDialect();
	it('leere Liste ergibt NULL (kein Syntaxfehler bei IN ())', () => {
		const q = dialect.sqlToQuery(sql`x IN (${inList([])})`);
		expect(q.sql).toBe('x IN (NULL)');
		expect(q.params).toEqual([]);
	});
	it('Werte als Parameter', () => {
		const q = dialect.sqlToQuery(sql`x IN (${inList(['a', 'b'])})`);
		expect(q.sql).toBe('x IN ($1, $2)');
		expect(q.params).toEqual(['a', 'b']);
	});
});

describe('str / num / resultRows', () => {
	it('str', () => {
		expect(str(null)).toBeNull();
		expect(str(undefined)).toBeNull();
		expect(str(0)).toBe('0');
		expect(str('')).toBe('');
	});
	it('num', () => {
		expect(num(null)).toBe(0);
		expect(num('12')).toBe(12);
	});
	it('resultRows', () => {
		expect(resultRows({ rows: [{ a: 1 }] })).toEqual([{ a: 1 }]);
		expect(resultRows(null)).toEqual([]);
		expect(resultRows({})).toEqual([]);
	});
});
