/**
 * Zeilenendenunabhängige Prüfsummen für SQL-Migrationen (Issue #10).
 *
 * Modul-Migrationen (`module_migration.checksum`) und Core-Migrationen (`drizzle.__drizzle_migrations.hash`)
 * wurden früher über die ROHEN Bytes gehasht. Je nach Checkout (Windows mit `core.autocrlf`, Linux) liegen
 * dieselben Dateien mit CRLF oder LF vor – derselbe Commit ergab also unterschiedliche Prüfsummen.
 *
 * - Maßgeblich ist jetzt der Hash über den normalisierten Text (`\r\n` → `\n`).
 * - Übergang: Als gültig gelten zusätzlich der Hash des Rohtexts und der reinen CRLF-Variante. Bestehende
 *   Datenbanken tragen je nach Build eine dieser Varianten; der Modul-Runner aktualisiert sie dann auf den
 *   normalisierten Wert. Eine inhaltliche Änderung fällt weiterhin auf.
 * - Drizzle selbst hasht Core-Migrationen über den Rohtext und vergleicht beim Migrieren NUR `created_at`
 *   (Journal `when`), nie den Hash. Der Hash wird nur für die Kompatibilitätsprüfung der Datensicherung genutzt.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** CRLF → LF; sonst unverändert */
export function normalizeMigrationSql(text: string): string {
	return text.replace(/\r\n/g, '\n');
}

/** Kanonische Prüfsumme (unabhängig von CRLF/LF) */
export function migrationChecksum(text: string): string {
	return sha256(normalizeMigrationSql(text));
}

/**
 * Alle Prüfsummen, die für diesen Migrationstext als „unverändert“ gelten: kanonisch (zuerst), Rohtext
 * und reine CRLF-Variante.
 */
export function acceptedMigrationChecksums(text: string): string[] {
	const lf = normalizeMigrationSql(text);
	return [...new Set([sha256(lf), sha256(text), sha256(lf.replace(/\n/g, '\r\n'))])];
}

/** Kanonischer Wert, falls `stored` eine gültige Variante von `text` ist, sonst `null` */
export function canonicalChecksumFor(stored: string, text: string): string | null {
	return acceptedMigrationChecksums(text).includes(stored) ? migrationChecksum(text) : null;
}

export interface CoreMigrationFile {
	tag: string;
	/** Journal `when` = `created_at` in `drizzle.__drizzle_migrations` */
	when: number;
	sql: string;
}

/** Liest Journal und SQL-Dateien der Core-Migrationen; bei Fehlern leere Liste. */
export function readCoreMigrationFiles(folder: string): CoreMigrationFile[] {
	try {
		const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
			entries?: { tag?: unknown; when?: unknown }[];
		};
		const out: CoreMigrationFile[] = [];
		for (const e of journal.entries ?? []) {
			if (typeof e.tag !== 'string' || typeof e.when !== 'number') continue;
			if (!/^[A-Za-z0-9_-]+$/.test(e.tag)) continue;
			try {
				out.push({
					tag: e.tag,
					when: e.when,
					sql: readFileSync(join(folder, `${e.tag}.sql`), 'utf8')
				});
			} catch {
				// fehlende Datei: Eintrag überspringen (Drizzle selbst würde hier abbrechen)
			}
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Kennungen der angewendeten Core-Migrationen dieses Servers für den Abgleich mit einer Sicherung:
 * die gespeicherten Hashes plus alle gültigen Varianten (kanonisch, CRLF, roh) der lokalen Dateien,
 * deren `when` angewendet ist. So passt eine Sicherung aus einem CRLF-Build auch auf einen LF-Build.
 */
export function coreMigrationIdentifiers(
	applied: { hash: string; createdAt: number | null }[],
	files: CoreMigrationFile[]
): string[] {
	const ids = new Set(applied.map((a) => a.hash));
	const times = new Set(applied.map((a) => a.createdAt).filter((t): t is number => t !== null));
	for (const f of files) {
		if (!times.has(f.when)) continue;
		for (const h of acceptedMigrationChecksums(f.sql)) ids.add(h);
	}
	return [...ids];
}

/**
 * Für den Export: gespeicherter Hash → kanonischer Hash der lokalen Datei mit gleichem `when`, sofern er
 * eine gültige Variante davon ist; sonst unverändert.
 */
export function canonicalCoreMigrationHash(
	applied: { hash: string; createdAt: number | null },
	files: CoreMigrationFile[]
): string {
	const file = files.find((f) => f.when === applied.createdAt);
	return (file && canonicalChecksumFor(applied.hash, file.sql)) ?? applied.hash;
}
