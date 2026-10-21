import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_PLACEHOLDER_SECRET, parseEnv } from '../../src/lib/server/core/env';
import { resolveBackupTempDir } from '../../src/lib/server/core/backup/tempfiles';

const SECRET = 'Zk3r9-QpLw7xVb2NmT8yHc4JdF6sGa1E';

describe('parseEnv', () => {
	it('lässt Entwicklung mit http-ORIGIN und Standardwerten zu', () => {
		const e = parseEnv({ APP_SECRET: SECRET });
		expect(e.ORIGIN).toBe('http://localhost:5173');
		expect(e.DATABASE_POOL_MAX).toBe(10);
	});

	it('behandelt leere Werte wie nicht gesetzt', () => {
		const e = parseEnv({ APP_SECRET: SECRET, ORIGIN: '  ', BACKUP_TMP_DIR: '' });
		expect(e.ORIGIN).toBe('http://localhost:5173');
		expect(e.BACKUP_TMP_DIR).toBeUndefined();
	});

	it('verlangt im Produktivbetrieb https für ORIGIN', () => {
		expect(() =>
			parseEnv({ NODE_ENV: 'production', APP_SECRET: SECRET, ORIGIN: 'http://intern.example.org' })
		).toThrow(/ORIGIN: ORIGIN muss im Produktivbetrieb mit https/);
		expect(
			parseEnv({ NODE_ENV: 'production', APP_SECRET: SECRET, ORIGIN: 'https://intern.example.org' })
				.ORIGIN
		).toBe('https://intern.example.org');
	});

	it('erlaubt im Produktivbetrieb http nur für localhost (Demo/E2E)', () => {
		for (const origin of ['http://localhost:4300', 'http://127.0.0.1:3000']) {
			expect(parseEnv({ NODE_ENV: 'production', APP_SECRET: SECRET, ORIGIN: origin }).ORIGIN).toBe(
				origin
			);
		}
	});

	it('verlangt im Produktivbetrieb ein ausdrücklich gesetztes ORIGIN', () => {
		expect(() => parseEnv({ NODE_ENV: 'production', APP_SECRET: SECRET })).toThrow(
			/ORIGIN muss im Produktivbetrieb gesetzt sein/
		);
	});

	it('lehnt im Produktivbetrieb den Build-Platzhalter und triviale Secrets ab', () => {
		const base = { NODE_ENV: 'production', ORIGIN: 'https://intern.example.org' };
		expect(() => parseEnv({ ...base, APP_SECRET: BUILD_PLACEHOLDER_SECRET })).toThrow(
			/Build-Platzhalter/
		);
		expect(() => parseEnv({ ...base, APP_SECRET: 'a'.repeat(40) })).toThrow(/zu einfach/);
		expect(() => parseEnv({ ...base, APP_SECRET: 'ab'.repeat(20) })).toThrow(/zu einfach/);
		// außerhalb der Produktion bleibt der Platzhalter erlaubt (Build-Stufe im Dockerfile)
		expect(parseEnv({ APP_SECRET: BUILD_PLACEHOLDER_SECRET }).APP_SECRET).toBe(
			BUILD_PLACEHOLDER_SECRET
		);
	});

	it('meldet zu kurze Secrets und relative BACKUP_TMP_DIR', () => {
		expect(() => parseEnv({ APP_SECRET: 'kurz' })).toThrow(/mindestens 32 Zeichen/);
		expect(() => parseEnv({ APP_SECRET: SECRET, BACKUP_TMP_DIR: 'tmp/backup' })).toThrow(
			/BACKUP_TMP_DIR muss ein absoluter Pfad sein/
		);
	});

	it('übernimmt BACKUP_TMP_DIR und BACKUP_MAX_BYTES', () => {
		const dir = join(process.cwd(), 'backup-tmp');
		const e = parseEnv({ APP_SECRET: SECRET, BACKUP_TMP_DIR: dir, BACKUP_MAX_BYTES: '1048576' });
		expect(e.BACKUP_TMP_DIR).toBe(dir);
		expect(e.BACKUP_MAX_BYTES).toBe(1048576);
	});
});

describe('resolveBackupTempDir', () => {
	const base = join(process.cwd(), 'fallback');

	it('nutzt ohne Angabe os.tmpdir()/ep-backup', () => {
		expect(resolveBackupTempDir(undefined, base)).toBe(join(base, 'ep-backup'));
		expect(resolveBackupTempDir('   ', base)).toBe(join(base, 'ep-backup'));
	});

	it('nutzt einen absoluten BACKUP_TMP_DIR unverändert (normalisiert)', () => {
		const dir = join(process.cwd(), 'volume', 'ep-backup');
		expect(resolveBackupTempDir(` ${dir} `, base)).toBe(dir);
	});

	it('ignoriert relative Pfade', () => {
		expect(resolveBackupTempDir('var/tmp', base)).toBe(join(base, 'ep-backup'));
	});
});
