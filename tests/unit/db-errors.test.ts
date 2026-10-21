import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { describeError, errorSummary, isUniqueViolation } from '$lib/server/core/db-errors';

const MARKER = 'Allergie-Erdnuss-Marker-4711';

/** Nachbau eines Postgres-Treiberfehlers (pg / PGlite) inkl. angehängter Abfrage */
function pgError(fields: Record<string, unknown>): Error {
	return Object.assign(new Error(String(fields.message ?? 'pg')), {
		name: 'error',
		detail: `Key (name)=(${MARKER}) already exists.`,
		query: `insert into x values ('${MARKER}')`,
		params: [MARKER],
		...fields
	});
}

const unique = () =>
	pgError({
		code: '23505',
		message: 'duplicate key value violates unique constraint "groups_slug_idx"',
		constraint: 'groups_slug_idx',
		table: 'groups'
	});

const wrap = (cause: unknown) =>
	new DrizzleQueryError(
		'insert into "groups" ("id", "slug") values ($1, $2)',
		['id-1', MARKER],
		cause as Error
	);

describe('isUniqueViolation', () => {
	it('erkennt 23505 hinter der Drizzle-Hülle (verschachtelte cause)', () => {
		expect(isUniqueViolation(wrap(unique()))).toBe(true);
		const nested = new Error('außen', { cause: wrap(unique()) });
		expect(isUniqueViolation(nested)).toBe(true);
	});

	it('prüft optional den Constraint', () => {
		const e = wrap(unique());
		expect(isUniqueViolation(e, 'groups_slug_idx')).toBe(true);
		expect(isUniqueViolation(e, 'slug')).toBe(true);
		expect(isUniqueViolation(e, 'groups_name_key')).toBe(false);
	});

	it('Constraint-Name nur in der Meldung (Fallback)', () => {
		const e = wrap(pgError({ code: '23505', message: 'duplicate key … "groups_slug_idx"' }));
		expect(isUniqueViolation(e, 'groups_slug_idx')).toBe(true);
	});

	it('andere Fehler, Nicht-Objekte und Zyklen → false', () => {
		expect(isUniqueViolation(wrap(pgError({ code: '23503' })))).toBe(false);
		expect(isUniqueViolation(new Error('duplicate key value violates unique'))).toBe(false);
		expect(isUniqueViolation(null)).toBe(false);
		expect(isUniqueViolation('23505')).toBe(false);
		const a: { code: string; cause?: unknown } = { code: 'x' };
		a.cause = a;
		expect(isUniqueViolation(a)).toBe(false);
	});
});

describe('describeError', () => {
	it('liefert Klasse, SQLSTATE, Constraint, Tabelle und SQL-Vorschau ohne Parameterwerte', () => {
		const d = describeError(wrap(unique()));
		expect(d).toMatchObject({
			name: 'DrizzleQueryError',
			code: '23505',
			message: 'duplicate key value violates unique constraint "groups_slug_idx"',
			constraint: 'groups_slug_idx',
			table: 'groups',
			sqlPreview: 'insert into "groups" ("id", "slug") values ($1, $2)'
		});
		expect(d.stack).toMatch(/^DrizzleQueryError: Failed query\n\s+at /);
		expect(JSON.stringify(d)).not.toContain(MARKER);
		expect(JSON.stringify(d)).not.toContain('params');
	});

	it('entfernt Eingabewerte aus Datenfehlern (Klasse 22)', () => {
		const e = wrap(
			pgError({ code: '22P02', message: `invalid input syntax for type uuid: "${MARKER}"` })
		);
		const d = describeError(e);
		expect(d.code).toBe('22P02');
		expect(d.message).toBe('invalid input syntax for type uuid: "…"');
		expect(JSON.stringify(d)).not.toContain(MARKER);
	});

	it('Hülle ohne Postgres-Fehler: nie die Hüllen-Meldung', () => {
		const d = describeError(wrap(new Error('Connection terminated')));
		expect(d.message).toBe('Connection terminated');
		expect(JSON.stringify(d)).not.toContain(MARKER);
		const d2 = describeError(wrap(undefined));
		expect(d2.message).toBe('Datenbankabfrage fehlgeschlagen');
		expect(JSON.stringify(d2)).not.toContain(MARKER);
	});

	it('normale Fehler und Nicht-Fehler', () => {
		expect(describeError(new TypeError('kaputt'))).toMatchObject({
			name: 'TypeError',
			message: 'kaputt'
		});
		expect(describeError('text')).toEqual({ name: 'string', message: 'text' });
		expect(describeError(Object.assign(new Error('x'), { code: 'ECONNRESET' })).code).toBe(
			'ECONNRESET'
		);
	});
});

describe('errorSummary', () => {
	it('einzeilig: Name, Code, Meldung, Constraint – ohne SQL und Werte', () => {
		const s = errorSummary(wrap(unique()));
		expect(s).toBe(
			'DrizzleQueryError: 23505 duplicate key value violates unique constraint "groups_slug_idx" (constraint groups_slug_idx)'
		);
		expect(s).not.toContain(MARKER);
		expect(s).not.toContain('\n');
		expect(errorSummary(new Error('kaputt'))).toBe('Error: kaputt');
	});
});
