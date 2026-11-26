import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	acceptedMigrationChecksums,
	canonicalChecksumFor,
	canonicalCoreMigrationHash,
	coreMigrationIdentifiers,
	SUPERSEDED_CORE_MIGRATIONS,
	migrationChecksum,
	normalizeMigrationSql,
	readCoreMigrationFiles
} from '$lib/server/core/modules/migration-checksum';
import { checkCompat, type CompatTarget } from '$lib/server/core/backup/compat';
import type { BackupMeta } from '$lib/server/core/backup/types';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const LF = 'CREATE TABLE IF NOT EXISTS "x" (\n\t"id" text PRIMARY KEY\n);\n';
const CRLF = LF.replace(/\n/g, '\r\n');
const CHANGED = LF.replace('"id" text', '"id" uuid');

describe('Migrations-Prüfsummen (zeilenendenunabhängig)', () => {
	it('CRLF und LF ergeben dieselbe kanonische Prüfsumme', () => {
		expect(normalizeMigrationSql(CRLF)).toBe(LF);
		expect(migrationChecksum(CRLF)).toBe(migrationChecksum(LF));
		expect(migrationChecksum(LF)).toBe(sha(LF));
	});

	it('akzeptiert alte Roh-Hashes beider Varianten, erkennt aber Inhaltsänderungen', () => {
		for (const text of [LF, CRLF]) {
			const accepted = acceptedMigrationChecksums(text);
			expect(accepted[0]).toBe(sha(LF));
			expect(accepted).toContain(sha(CRLF));
			expect(canonicalChecksumFor(sha(CRLF), text)).toBe(sha(LF));
			expect(canonicalChecksumFor(sha(LF), text)).toBe(sha(LF));
		}
		expect(canonicalChecksumFor(sha(CRLF), CHANGED)).toBeNull();
		expect(canonicalChecksumFor(sha(LF), CHANGED)).toBeNull();
	});

	it('Core: Kennungen enthalten alle Varianten nur angewendeter Dateien', () => {
		const files = [
			{ tag: '0000_a', when: 1, sql: LF },
			{ tag: '0001_b', when: 2, sql: 'SELECT 2;\n' }
		];
		const ids = coreMigrationIdentifiers([{ hash: sha(LF), createdAt: 1 }], files);
		expect(ids).toContain(sha(CRLF));
		expect(ids).not.toContain(sha('SELECT 2;\n'));
		// Export: CRLF-Hash eines Windows-Builds → kanonisch
		expect(canonicalCoreMigrationHash({ hash: sha(CRLF), createdAt: 1 }, files)).toBe(sha(LF));
		// unbekannter Hash bleibt, wie er ist
		expect(canonicalCoreMigrationHash({ hash: 'fremd', createdAt: 1 }, files)).toBe('fremd');
	});

	it('liest die echten Core-Migrationen laut Journal', () => {
		const files = readCoreMigrationFiles(resolve(process.cwd(), 'drizzle'));
		expect(files.length).toBeGreaterThanOrEqual(7);
		expect(files[0]!.tag).toBe('0000_init');
		for (const f of files) {
			const lf = normalizeMigrationSql(f.sql);
			expect(migrationChecksum(lf.replace(/\n/g, '\r\n'))).toBe(migrationChecksum(lf));
		}
		expect(readCoreMigrationFiles(resolve(process.cwd(), 'gibt-es-nicht'))).toEqual([]);
	});
});

describe('checkCompat mit abweichenden Zeilenenden', () => {
	const meta = (checksum: string, core: string[]): BackupMeta => ({
		format: 'ep-intern-backup',
		formatVersion: 1,
		createdAt: '2026-10-20T10:00:00.000Z',
		appVersion: '0.0.1',
		sourceOrigin: null,
		createdBy: { id: 'u1', name: 'Admin' },
		scopes: ['demo'],
		includesFiles: false,
		coreMigrations: core,
		modules: {
			demo: {
				name: 'Demo',
				installedVersion: '1.0.0',
				enabled: true,
				migrations: [{ name: '0001_init', checksum }]
			}
		},
		tables: [],
		files: { count: 0, bytes: 0 },
		keyCheck: 'k'
	});
	const target = (sqlText: string): CompatTarget => ({
		coreMigrations: coreMigrationIdentifiers(
			[{ hash: sha(sqlText), createdAt: 1 }],
			[{ tag: '0000_init', when: 1, sql: sqlText }]
		),
		modules: {
			demo: {
				registered: true,
				migrations: [
					{
						name: '0001_init',
						checksum: migrationChecksum(sqlText),
						accepted: acceptedMigrationChecksums(sqlText)
					}
				]
			}
		},
		tables: new Map()
	});

	it('Sicherung aus CRLF-Build passt auf LF-Server und umgekehrt', () => {
		const winToLinux = checkCompat(meta(sha(CRLF), [sha(CRLF)]), target(LF));
		expect(winToLinux.scopes.demo).toEqual({ available: true });
		const linuxToWin = checkCompat(meta(sha(LF), [sha(LF)]), target(CRLF));
		expect(linuxToWin.scopes.demo).toEqual({ available: true });
	});

	it('inhaltlich veränderte Migration bleibt gesperrt', () => {
		const mod = checkCompat(meta(sha(CHANGED), [sha(LF)]), target(LF));
		expect(mod.scopes.demo).toEqual({
			available: false,
			reason: 'Migration 0001_init weicht von diesem Server ab'
		});
		const core = checkCompat(meta(sha(LF), [sha(CHANGED)]), target(LF));
		expect(core.scopes.demo?.reason).toBe('Sicherung stammt aus einer neueren Version');
	});
});

describe('ersetzte Core-Migration 0014 (Zusammenführung extern → main)', () => {
	const files = readCoreMigrationFiles(resolve(process.cwd(), 'drizzle'));
	const byTag = (tag: string) => files.find((f) => f.tag === tag)!;
	const [superseded] = SUPERSEDED_CORE_MIGRATIONS;
	// Inhalt von drizzle/0014_module_updates.sql auf `extern` (Commit 9c04849): beide Varianten aus der Datei
	const externLf = readFileSync(
		resolve(process.cwd(), 'tests/fixtures/migrations/0014_module_updates.extern.sql'),
		'utf8'
	);
	const externHashes = [sha(externLf), sha(externLf.replace(/\n/g, '\r\n'))];
	const metaWith = (coreMigrations: string[]): BackupMeta => ({
		format: 'atrium-backup',
		formatVersion: 1,
		createdAt: '2026-11-20T10:00:00.000Z',
		appVersion: '2.0.0-pre.1',
		sourceOrigin: null,
		createdBy: { id: 'u1', name: 'Admin' },
		scopes: ['core:settings'],
		includesFiles: false,
		coreMigrations,
		modules: {},
		tables: [],
		files: { count: 0, bytes: 0 },
		keyCheck: 'k'
	});
	const upTo = (tag: string, override?: Record<string, string>) =>
		files
			.slice(0, files.findIndex((f) => f.tag === tag) + 1)
			.map((f) => ({ hash: override?.[f.tag] ?? sha(f.sql), createdAt: f.when }));
	const externBackup = (variant: number) =>
		metaWith([...upTo('0013_user_admin').map((a) => a.hash), externHashes[variant]!]);

	it('hinterlegt genau die Hashes der extern-Fassung, gleiches when wie main', () => {
		expect(superseded!.hashes).toEqual(externHashes);
		expect(superseded!.when).toBe(byTag('0014_marketplace_cache').when);
		expect(superseded!.coveredBy).toBe(byTag('0015_module_updates_reconcile').when);
	});

	for (const [stand, applied] of [
		// frische Datenbank und Bestand von main tragen dieselben Hashes (0014_marketplace_cache + 0015)
		['frisch installiert bzw. von main aktualisiert', () => upTo('0015_module_updates_reconcile')],
		[
			'von extern aktualisiert',
			() => upTo('0015_module_updates_reconcile', { '0014_marketplace_cache': externHashes[0]! })
		]
	] as const) {
		it(`Sicherung aus extern (LF und CRLF) passt auf ${stand}`, () => {
			const target: CompatTarget = {
				coreMigrations: coreMigrationIdentifiers(applied(), files),
				modules: {},
				tables: new Map([['public.setting', { columns: [] } as never]])
			};
			for (const variant of [0, 1]) {
				expect(checkCompat(externBackup(variant), target).scopes['core:settings']).toEqual({
					available: true
				});
			}
			// Sicherung aus main passt ebenso
			const mainBackup = metaWith(upTo('0014_marketplace_cache').map((a) => a.hash));
			expect(checkCompat(mainBackup, target).scopes['core:settings']).toEqual({ available: true });
		});
	}

	it('ohne angewendete 0015 bleibt die extern-Sicherung gesperrt', () => {
		const target: CompatTarget = {
			coreMigrations: coreMigrationIdentifiers(upTo('0014_marketplace_cache'), files),
			modules: {},
			tables: new Map()
		};
		expect(checkCompat(externBackup(0), target).scopes['core:settings']?.reason).toBe(
			'Sicherung stammt aus einer neueren Version'
		);
	});
});
