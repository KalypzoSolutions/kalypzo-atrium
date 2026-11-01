import { describe, expect, it } from 'vitest';
import { checkCompat, type CompatTarget } from '$lib/server/core/backup/compat';
import type { BackupMeta, TableInfo } from '$lib/server/core/backup/types';

const cols = (...names: string[]) => names.map((name) => ({ name, type: 'text' }));
const info = (name: string, ...names: string[]): TableInfo => {
	const [schema, table] = name.split('.') as [string, string];
	return {
		schema,
		table,
		columns: names.map((n) => ({ name: n, type: 'text', nullable: true })),
		primaryKey: ['id'],
		foreignKeys: []
	};
};

function meta(over: Partial<BackupMeta> = {}): BackupMeta {
	return {
		format: 'ep-intern-backup',
		formatVersion: 1,
		createdAt: '2026-10-20T10:00:00.000Z',
		appVersion: '0.0.1',
		sourceOrigin: null,
		createdBy: { id: 'u1', name: 'Admin' },
		scopes: ['core:users', 'core:audit', 'members'],
		includesFiles: false,
		coreMigrations: ['h1', 'h2'],
		modules: {
			members: {
				name: 'Mitglieder',
				installedVersion: '1.0.0',
				enabled: true,
				migrations: [
					{ name: '0001_init', checksum: 'c1' },
					{ name: '0002_more', checksum: 'c2' }
				]
			}
		},
		tables: [
			{
				name: 'public.user',
				scope: 'core:users',
				columns: cols('id', 'email'),
				primaryKey: ['id'],
				rows: 1
			},
			{
				name: 'public.audit_log',
				scope: 'core:audit',
				columns: cols('id'),
				primaryKey: ['id'],
				rows: 1
			},
			{
				name: 'public.file',
				scope: 'core:users,members',
				columns: cols('id', 'module_id'),
				primaryKey: ['id'],
				rows: 0
			},
			{
				name: 'mod_members.members',
				scope: 'members',
				columns: cols('id'),
				primaryKey: ['id'],
				rows: 2
			}
		],
		files: { count: 0, bytes: 0 },
		keyCheck: 'k',
		...over
	};
}

function target(over: Partial<CompatTarget> = {}): CompatTarget {
	return {
		coreMigrations: ['h1', 'h2', 'h3'],
		modules: {
			members: {
				registered: true,
				migrations: [
					{ name: '0001_init', checksum: 'c1' },
					{ name: '0002_more', checksum: 'c2' }
				]
			}
		},
		tables: new Map(
			[
				info('public.user', 'id', 'email', 'name'),
				info('public.audit_log', 'id'),
				info('public.file', 'id', 'module_id')
			].map((t) => [`${t.schema}.${t.table}`, t])
		),
		...over
	};
}

describe('checkCompat', () => {
	it('gleicher Stand: alles verfügbar, keine Warnung', () => {
		const r = checkCompat(meta(), target());
		expect(r.scopes).toEqual({
			'core:users': { available: true },
			'core:audit': { available: true },
			members: { available: true }
		});
		expect(r.warnings).toEqual([]);
	});

	it('neuere Core-Migration in der Sicherung sperrt alle Bereiche', () => {
		const r = checkCompat(meta({ coreMigrations: ['h1', 'h9'] }), target());
		for (const s of Object.values(r.scopes)) {
			expect(s).toEqual({ available: false, reason: 'Sicherung stammt aus einer neueren Version' });
		}
	});

	it('ohne Core-Liste im Ziel nur Warnung', () => {
		const r = checkCompat(meta(), target({ coreMigrations: [] }));
		expect(r.scopes['core:users']!.available).toBe(true);
		expect(r.warnings).toHaveLength(1);
	});

	it('unbekannte Spalte in Core-Tabelle sperrt nur diesen Bereich', () => {
		const m = meta();
		m.tables[1] = { ...m.tables[1]!, columns: cols('id', 'neu') };
		const r = checkCompat(m, target());
		expect(r.scopes['core:audit']).toEqual({
			available: false,
			reason: 'Unbekannte Spalten in public.audit_log: neu'
		});
		expect(r.scopes['core:users']!.available).toBe(true);
	});

	it('fehlende Core-Tabelle', () => {
		const t = target();
		t.tables.delete('public.audit_log');
		expect(checkCompat(meta(), t).scopes['core:audit']!.reason).toMatch(/fehlt/);
	});

	it('Modul nicht registriert', () => {
		const r = checkCompat(meta(), target({ modules: {} }));
		expect(r.scopes.members).toEqual({
			available: false,
			reason: 'Modul ist auf diesem Server nicht installiert'
		});
	});

	it('ältere Modul-Sicherung (Präfix) ist verfügbar, mit Warnung', () => {
		const m = meta();
		m.modules.members!.migrations = [{ name: '0001_init', checksum: 'c1' }];
		const r = checkCompat(m, target());
		expect(r.scopes.members).toEqual({ available: true });
		expect(r.warnings.join(' ')).toMatch(/älteren Stand/);
	});

	it('neuere Modul-Sicherung ist gesperrt', () => {
		const m = meta();
		m.modules.members!.migrations.push({ name: '0003_neu', checksum: 'c3' });
		expect(checkCompat(m, target()).scopes.members).toEqual({
			available: false,
			reason: 'Sicherung ist neuer als dieses Modul'
		});
	});

	it('abweichende Prüfsumme sperrt das Modul', () => {
		const m = meta();
		m.modules.members!.migrations[1] = { name: '0002_more', checksum: 'x' };
		expect(checkCompat(m, target()).scopes.members!.reason).toMatch(/weicht/);
	});

	it('Lücke in den Migrationen sperrt das Modul', () => {
		const m = meta();
		m.modules.members!.migrations = [{ name: '0002_more', checksum: 'c2' }];
		expect(checkCompat(m, target()).scopes.members!.available).toBe(false);
	});

	it('Moduldaten ohne Eintrag in modules', () => {
		expect(checkCompat(meta({ modules: {} }), target()).scopes.members!.reason).toMatch(/fehlen/);
	});

	it('unbekannter Core-Bereich', () => {
		const r = checkCompat(meta({ scopes: ['core:gibtsnicht'] }), target());
		expect(r.scopes['core:gibtsnicht']!.available).toBe(false);
	});

	it('fremde Tabelle im Modulbereich', () => {
		const m = meta();
		m.tables.push({
			name: 'mod_events.events',
			scope: 'members',
			columns: cols('id'),
			primaryKey: ['id'],
			rows: 0
		});
		expect(checkCompat(m, target()).scopes.members!.reason).toMatch(/Unerwartete Tabelle/);
	});

	it('Modulanteil an public.file mit unbekannter Spalte', () => {
		const m = meta();
		m.tables[2] = { ...m.tables[2]!, columns: cols('id', 'module_id', 'extra') };
		const r = checkCompat(m, target());
		expect(r.scopes.members!.available).toBe(false);
		expect(r.scopes['core:users']!.available).toBe(false);
	});

	it('fehlendes Modul mit gesicherter Herkunft: Quelle zum Installieren (Kalypzo Atrium)', () => {
		const m = meta();
		m.modules.members!.origin = {
			version: '1.0.0',
			sourceType: 'github',
			source: { owner: 'org', repo: 'mods', path: 'modules/members', ref: 'main' },
			commit: 'c'.repeat(40),
			contentHash: 'sha256-x'
		};
		const t = target({ modules: { members: { registered: false, migrations: [] } } });
		const r = checkCompat(m, t);
		expect(r.scopes.members).toMatchObject({
			available: false,
			installSource: `github:org/mods/modules/members#${'c'.repeat(40)}`
		});
		expect(r.scopes.members!.reason).toMatch(/zuerst 1\.0\.0 aus der gesicherten Quelle/);
		// ohne Herkunft (ältere Sicherung) kein Hinweis
		const old = checkCompat(meta(), t);
		expect(old.scopes.members!.installSource).toBeUndefined();
	});
});
