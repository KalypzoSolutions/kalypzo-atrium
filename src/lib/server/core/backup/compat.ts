/**
 * Datensicherung – Kompatibilität einer Sicherung mit dem Zielserver (reine Logik, ohne Datenbank).
 *
 * - Core: alle Core-Migrationen der Sicherung müssen im Ziel angewendet sein, sonst sind ALLE Bereiche
 *   gesperrt („Sicherung stammt aus einer neueren Version“). Liefert das Ziel keine Liste (z. B. Tests ohne
 *   drizzle-Tabelle), gibt es nur eine Warnung.
 * - Core-Bereiche: jede Spalte der gesicherten Tabelle muss im Ziel existieren (aktuelle Struktur).
 * - Module: registriert; die Migrationen der Sicherung sind ein Präfix der Ziel-Migrationen mit gleicher
 *   Prüfsumme (zeilenendenunabhängig, siehe `modules/migration-checksum.ts`; das Schema wird beim Wiederherstellen auf genau diesen Stand gebracht). Der Anteil in
 *   `public.file` wird wie eine Core-Tabelle geprüft.
 */
import { CORE_SCOPE_KEYS, type BackupMeta, type TableInfo } from './types';
import { t } from '$lib/i18n';

export interface CompatTarget {
	/**
	 * Kennungen der angewendeten Core-Migrationen: gespeicherte Drizzle-Hashes plus die gültigen
	 * Zeilenenden-Varianten der lokalen Dateien (`coreMigrationIdentifiers`).
	 */
	coreMigrations: string[];
	modules: Record<
		string,
		{
			registered: boolean;
			/**
			 * `checksum` = kanonische Prüfsumme (zeilenendenunabhängig); `accepted` = weitere gültige
			 * Varianten (Roh-/CRLF-Hash), damit ältere Sicherungen aus Windows-/Linux-Builds passen.
			 */
			migrations: { name: string; checksum: string; accepted?: string[] }[];
		}
	>;
	/** aktuelle Struktur, Schlüssel `schema.tabelle` */
	tables: Map<string, TableInfo>;
}

export interface CompatResult {
	scopes: Record<
		string,
		{
			available: boolean;
			reason?: string;
			/** Fehlendes Modul: Quelle zum Installieren (`github:owner/repo/pfad#commit`), sonst fehlt das Feld */
			installSource?: string;
		}
	>;
	warnings: string[];
}

const MODULE_SCOPE = /^[a-z][a-z0-9-]{1,30}$/;

export function moduleSchemaFor(id: string): string {
	return `mod_${id.replace(/-/g, '_')}`;
}

/** Bereiche einer Tabelle laut `backup.json` (`scope` ist bei zusammengelegten Tabellen kommagetrennt) */
export function tableScopes(t: { scope: string }): string[] {
	return t.scope
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function columnProblem(
	table: BackupMeta['tables'][number],
	target: Map<string, TableInfo>
): string | null {
	const info = target.get(table.name);
	if (!info) return t('backup.compat.tableMissing', { table: table.name });
	const have = new Set(info.columns.map((c) => c.name));
	const unknown = table.columns.map((c) => c.name).filter((c) => !have.has(c));
	if (unknown.length) {
		return t('backup.compat.unknownColumns', { table: table.name, columns: unknown.join(', ') });
	}
	return null;
}

export function checkCompat(meta: BackupMeta, target: CompatTarget): CompatResult {
	const warnings: string[] = [];
	const scopes: CompatResult['scopes'] = {};

	let coreBlock: string | null = null;
	if (!target.coreMigrations.length) {
		if (meta.coreMigrations.length) {
			warnings.push(t('backup.compat.coreVersionUnknown'));
		}
	} else {
		const have = new Set(target.coreMigrations);
		if (meta.coreMigrations.some((m) => !have.has(m))) {
			coreBlock = t('backup.compat.newerVersion');
		}
	}

	for (const scope of [...new Set(meta.scopes)]) {
		if (coreBlock) {
			scopes[scope] = { available: false, reason: coreBlock };
			continue;
		}
		const tables = meta.tables.filter((tbl) => tableScopes(tbl).includes(scope));
		if (scope.startsWith('core:')) {
			if (!(CORE_SCOPE_KEYS as readonly string[]).includes(scope)) {
				scopes[scope] = { available: false, reason: t('backup.compat.unknownScope') };
				continue;
			}
			const problem = tables
				.filter((tbl) => tbl.name.startsWith('public.'))
				.map((tbl) => columnProblem(tbl, target.tables))
				.find((p) => p !== null);
			scopes[scope] = problem ? { available: false, reason: problem } : { available: true };
			continue;
		}

		if (!MODULE_SCOPE.test(scope)) {
			scopes[scope] = { available: false, reason: t('backup.compat.unknownScope') };
			continue;
		}
		const tgt = target.modules[scope];
		if (!tgt?.registered) {
			const origin = meta.modules[scope]?.origin;
			const src = origin?.source as { owner?: string; repo?: string; path?: string } | undefined;
			const installSource =
				origin?.sourceType === 'github' && src?.owner && src.repo && origin.commit
					? `github:${src.owner}/${src.repo}${src.path ? `/${src.path}` : ''}#${origin.commit}`
					: undefined;
			scopes[scope] = {
				available: false,
				reason: installSource
					? t('backup.compat.moduleNotInstalledSource', { version: origin!.version })
					: t('backup.compat.moduleNotInstalled'),
				...(installSource ? { installSource } : {})
			};
			continue;
		}
		const src = meta.modules[scope];
		if (!src) {
			scopes[scope] = { available: false, reason: t('backup.compat.moduleDataMissing') };
			continue;
		}
		const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
		const backupMigs = [...src.migrations].sort(byName);
		const targetMigs = [...tgt.migrations].sort(byName);
		let reason: string | null = null;
		for (let i = 0; i < backupMigs.length; i++) {
			const b = backupMigs[i]!;
			const mig = targetMigs[i];
			if (!mig || mig.name !== b.name) {
				reason = targetMigs.some((m) => m.name === b.name)
					? t('backup.compat.migrationMismatch', { name: b.name })
					: t('backup.compat.newerThanModule');
				break;
			}
			if (mig.checksum !== b.checksum && !mig.accepted?.includes(b.checksum)) {
				reason = t('backup.compat.migrationDiffers', { name: b.name });
				break;
			}
		}
		if (!reason) {
			const schemaName = moduleSchemaFor(scope);
			const foreign = tables.find(
				(tbl) => !tbl.name.startsWith(`${schemaName}.`) && tbl.name !== 'public.file'
			);
			if (foreign) reason = t('backup.compat.unexpectedTable', { table: foreign.name });
		}
		if (!reason) {
			const file = tables.find((tbl) => tbl.name === 'public.file');
			if (file) reason = columnProblem(file, target.tables);
		}
		if (reason) {
			scopes[scope] = { available: false, reason };
			continue;
		}
		scopes[scope] = { available: true };
		if (targetMigs.length > backupMigs.length) {
			warnings.push(t('backup.compat.olderState', { name: src.name }));
		}
	}
	return { scopes, warnings };
}
