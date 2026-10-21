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
	scopes: Record<string, { available: boolean; reason?: string }>;
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
	const t = target.get(table.name);
	if (!t) return `Tabelle ${table.name} fehlt auf diesem Server`;
	const have = new Set(t.columns.map((c) => c.name));
	const unknown = table.columns.map((c) => c.name).filter((c) => !have.has(c));
	if (unknown.length) return `Unbekannte Spalten in ${table.name}: ${unknown.join(', ')}`;
	return null;
}

export function checkCompat(meta: BackupMeta, target: CompatTarget): CompatResult {
	const warnings: string[] = [];
	const scopes: CompatResult['scopes'] = {};

	let coreBlock: string | null = null;
	if (!target.coreMigrations.length) {
		if (meta.coreMigrations.length) {
			warnings.push(
				'Die Core-Version dieses Servers ließ sich nicht ermitteln; die Kompatibilität wurde nur anhand der Tabellen geprüft.'
			);
		}
	} else {
		const have = new Set(target.coreMigrations);
		if (meta.coreMigrations.some((m) => !have.has(m))) {
			coreBlock = 'Sicherung stammt aus einer neueren Version';
		}
	}

	for (const scope of [...new Set(meta.scopes)]) {
		if (coreBlock) {
			scopes[scope] = { available: false, reason: coreBlock };
			continue;
		}
		const tables = meta.tables.filter((t) => tableScopes(t).includes(scope));
		if (scope.startsWith('core:')) {
			if (!(CORE_SCOPE_KEYS as readonly string[]).includes(scope)) {
				scopes[scope] = { available: false, reason: 'Unbekannter Bereich' };
				continue;
			}
			const problem = tables
				.filter((t) => t.name.startsWith('public.'))
				.map((t) => columnProblem(t, target.tables))
				.find((p) => p !== null);
			scopes[scope] = problem ? { available: false, reason: problem } : { available: true };
			continue;
		}

		if (!MODULE_SCOPE.test(scope)) {
			scopes[scope] = { available: false, reason: 'Unbekannter Bereich' };
			continue;
		}
		const tgt = target.modules[scope];
		if (!tgt?.registered) {
			scopes[scope] = { available: false, reason: 'Modul ist auf diesem Server nicht installiert' };
			continue;
		}
		const src = meta.modules[scope];
		if (!src) {
			scopes[scope] = { available: false, reason: 'Moduldaten fehlen in der Sicherung' };
			continue;
		}
		const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
		const backupMigs = [...src.migrations].sort(byName);
		const targetMigs = [...tgt.migrations].sort(byName);
		let reason: string | null = null;
		for (let i = 0; i < backupMigs.length; i++) {
			const b = backupMigs[i]!;
			const t = targetMigs[i];
			if (!t || t.name !== b.name) {
				reason = targetMigs.some((m) => m.name === b.name)
					? `Migration ${b.name} passt nicht zu diesem Server`
					: 'Sicherung ist neuer als dieses Modul';
				break;
			}
			if (t.checksum !== b.checksum && !t.accepted?.includes(b.checksum)) {
				reason = `Migration ${b.name} weicht von diesem Server ab`;
				break;
			}
		}
		if (!reason) {
			const schemaName = moduleSchemaFor(scope);
			const foreign = tables.find(
				(t) => !t.name.startsWith(`${schemaName}.`) && t.name !== 'public.file'
			);
			if (foreign) reason = `Unerwartete Tabelle ${foreign.name} im Modul`;
		}
		if (!reason) {
			const file = tables.find((t) => t.name === 'public.file');
			if (file) reason = columnProblem(file, target.tables);
		}
		if (reason) {
			scopes[scope] = { available: false, reason };
			continue;
		}
		scopes[scope] = { available: true };
		if (targetMigs.length > backupMigs.length) {
			warnings.push(
				`${src.name}: Die Sicherung hat einen älteren Stand; neuere Migrationen werden nach dem Einfügen angewendet.`
			);
		}
	}
	return { scopes, warnings };
}
