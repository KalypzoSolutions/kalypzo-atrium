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
});
