import { describe, expect, it } from 'vitest';
import { splitSqlStatements } from '../../src/lib/server/core/modules/split-sql';

describe('splitSqlStatements', () => {
	it('trennt Statements und ignoriert Kommentare', () => {
		const sql = `-- Kommentar; mit Semikolon\nCREATE TABLE a (x int);\n/* a; b */ CREATE INDEX i ON a (x);\n`;
		expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE a (x int)', 'CREATE INDEX i ON a (x)']);
	});
	it('beachtet Strings, Bezeichner und Dollar-Quoting', () => {
		const sql = `INSERT INTO t VALUES ('a;b', 'it''s');\nCREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql;`;
		expect(splitSqlStatements(sql)).toEqual([
			"INSERT INTO t VALUES ('a;b', 'it''s')",
			'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1; $$ LANGUAGE sql'
		]);
	});
	it('erkennt Backslash-Escapes in E-Strings', () => {
		// Standard-String 'c\' endet am Anführungszeichen (standard_conforming_strings = on)
		const sql = String.raw`INSERT INTO t VALUES (E'a\';b');
SELECT 'c\';SELECT 2;`;
		expect(splitSqlStatements(sql)).toEqual([
			String.raw`INSERT INTO t VALUES (E'a\';b')`,
			String.raw`SELECT 'c\'`,
			'SELECT 2'
		]);
	});
	it('erkennt Dollar-Tags mit Ziffern und lässt Parameter wie $1 in Ruhe', () => {
		const sql = `CREATE FUNCTION f() RETURNS int AS $body_1$ SELECT 1; SELECT $1; $body_1$ LANGUAGE sql;\nSELECT 3;`;
		expect(splitSqlStatements(sql)).toEqual([
			'CREATE FUNCTION f() RETURNS int AS $body_1$ SELECT 1; SELECT $1; $body_1$ LANGUAGE sql',
			'SELECT 3'
		]);
	});
	it('überspringt verschachtelte Blockkommentare vollständig', () => {
		const sql = `/* außen /* innen; */ immer noch Kommentar; */ CREATE TABLE b (x int);\nSELECT 1;`;
		expect(splitSqlStatements(sql)).toEqual(['CREATE TABLE b (x int)', 'SELECT 1']);
	});
});
