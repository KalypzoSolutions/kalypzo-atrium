/**
 * Datensicherung – Bereiche (Core-Bereiche und Module) und ihre Tabellen.
 *
 * Core-Bereiche sind fest (`CORE_SCOPE_KEYS`); jedes registrierte Modul mit vorhandenem Schema
 * `mod_<id>` ist ein Bereich (alle Basistabellen + seine Zeilen in `public.file`).
 * Nie gesichert: `session`, `verification`, `permission`, `module_state`, `module_migration`, `drizzle.*`.
 */
import { sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../database/client';
import { allDefinitions, getDefinition } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';
import { MODULE_ID_PATTERN, moduleSchemaName } from '../modules/types';
import { IDENTIFIER, loadTableInfo, sortTablesForInsert } from './introspect';
import { CORE_SCOPE_KEYS, type BackupScopeInfo, type PlannedTable, type TableInfo } from './types';

type CoreScopeKey = (typeof CORE_SCOPE_KEYS)[number];

interface CoreScopeDef {
	label: string;
	description: string;
	implies?: { scope: string; reason: string }[];
	/** Tabellen in `public` mit optionalem Zeilenfilter (nur Konstanten) */
	tables: { table: string; where?: string }[];
}

const CORE_SCOPES: Record<CoreScopeKey, CoreScopeDef> = {
	'core:users': {
		label: 'Benutzer',
		description:
			'Benutzerkonten mit Anmeldedaten, Zwei-Faktor-Einstellungen, persönlichen Einstellungen, Rollenzuweisungen, Einzelrechten und Profilbildern.',
		implies: [{ scope: 'core:api-keys', reason: 'API-Keys gehören zu Benutzerkonten' }],
		tables: [
			{ table: 'user' },
			{ table: 'account' },
			{ table: 'two_factor' },
			{ table: 'setting', where: `scope_id <> ''` },
			{ table: 'user_role' },
			{ table: 'user_role_grant' },
			{ table: 'user_permission' },
			{ table: 'file', where: `module_id = 'core'` }
		]
	},
	'core:roles': {
		label: 'Rollen',
		description: 'Rollen mit ihren Rechten und Zuweisungen.',
		tables: [
			{ table: 'role' },
			{ table: 'role_permission' },
			{ table: 'role_grant_applied' },
			{ table: 'user_role' },
			{ table: 'user_role_grant' }
		]
	},
	'core:api-keys': {
		label: 'API-Keys',
		description: 'API-Keys aller Benutzer (nur gespeicherte Prüfsummen, keine Klartext-Schlüssel).',
		tables: [{ table: 'api_key' }]
	},
	'core:settings': {
		label: 'Einstellungen',
		description: 'Globale Einstellungen inkl. Modul-Einstellungen und Zugangsdaten.',
		tables: [{ table: 'setting', where: `scope_id = ''` }]
	},
	'core:audit': {
		label: 'Audit-Log',
		description: 'Alle Audit-Einträge.',
		tables: [{ table: 'audit_log' }]
	},
	'core:api-log': {
		label: 'API-Protokoll',
		description: 'Protokoll der API-Aufrufe.',
		tables: [{ table: 'api_log' }]
	},
	'core:jobs': {
		label: 'Job-Läufe',
		description: 'Letzte Läufe der Hintergrundjobs.',
		tables: [{ table: 'job_run' }]
	},
	'core:ai-usage': {
		label: 'KI-Nutzung',
		description: 'Erfasste KI-Nutzung und Kosten.',
		tables: [{ table: 'ai_usage' }]
	}
};

const isCoreScope = (k: string): k is CoreScopeKey =>
	(CORE_SCOPE_KEYS as readonly string[]).includes(k);

/** Vorhandene Schemas aus einer Liste */
async function existingSchemas(db: DbOrTx, names: string[]): Promise<Set<string>> {
	const list = names.filter((n) => IDENTIFIER.test(n));
	if (!list.length) return new Set();
	const res = (await db.execute(
		sql`SELECT nspname::text AS name FROM pg_catalog.pg_namespace WHERE nspname IN (${sql.join(
			list.map((n) => sql`${n}`),
			sql`, `
		)})`
	)) as unknown as { rows: { name: string }[] };
	return new Set(res.rows.map((r) => String(r.name)));
}

/** Module (IDs) in Abhängigkeitsreihenfolge: Abhängigkeiten zuerst, sonst alphabetisch. */
export function moduleInsertOrder(mods: { id: string; deps: string[] }[]): string[] {
	const byId = new Map(mods.map((m) => [m.id, m]));
	const done = new Set<string>();
	const visiting = new Set<string>();
	const out: string[] = [];
	const visit = (id: string) => {
		if (done.has(id) || visiting.has(id)) return;
		visiting.add(id);
		for (const d of [...(byId.get(id)?.deps ?? [])].sort()) if (byId.has(d)) visit(d);
		visiting.delete(id);
		done.add(id);
		out.push(id);
	};
	for (const id of [...byId.keys()].sort()) visit(id);
	return out;
}

function moduleDeps(id: string): string[] {
	const def = getDefinition(id);
	if (!def) return [];
	return [...def.manifest.dependencies, ...(def.manifest.optionalDependencies ?? [])];
}

/** Alle sicherbaren Bereiche: Core-Bereiche, dann Module (mit vorhandenem Schema) nach Abhängigkeiten. */
export async function listBackupScopes(): Promise<BackupScopeInfo[]> {
	const out: BackupScopeInfo[] = CORE_SCOPE_KEYS.map((key) => ({
		key,
		group: 'core',
		label: CORE_SCOPES[key].label,
		description: CORE_SCOPES[key].description,
		implies: [...(CORE_SCOPES[key].implies ?? [])],
		enabled: true
	}));
	const defs = allDefinitions().filter((d) => MODULE_ID_PATTERN.test(d.manifest.id));
	const schemas = await existingSchemas(
		getDb(),
		defs.map((d) => moduleSchemaName(d.manifest.id))
	);
	const present = defs.filter((d) => schemas.has(moduleSchemaName(d.manifest.id)));
	const order = moduleInsertOrder(
		present.map((d) => ({ id: d.manifest.id, deps: moduleDeps(d.manifest.id) }))
	);
	const byId = new Map(present.map((d) => [d.manifest.id, d]));
	for (const id of order) {
		const def = byId.get(id)!;
		out.push({
			key: id,
			group: 'module',
			label: def.manifest.name,
			description:
				def.manifest.description ?? `Alle Daten und Dateien des Moduls ${def.manifest.name}.`,
			// Modul-Abhängigkeiten werden bewusst nicht impliziert
			implies: [],
			enabled: await isModuleEnabled(id)
		});
	}
	return out;
}

/**
 * Auswahl auflösen: Duplikate entfernen, implizierte Bereiche transitiv ergänzen. Ergebnis in der
 * Reihenfolge von `all`; `implied` nur für nicht ausdrücklich gewählte Bereiche.
 */
export function resolveScopes(
	keys: string[],
	all: BackupScopeInfo[]
): {
	scopes: string[];
	implied: { scope: string; by: string; reason: string }[];
	unknown: string[];
} {
	const byKey = new Map(all.map((s) => [s.key, s]));
	const selected = [...new Set(keys.map(String))];
	const unknown = selected.filter((k) => !byKey.has(k));
	const chosen = new Set(selected.filter((k) => byKey.has(k)));
	const result = new Set(chosen);
	const implied: { scope: string; by: string; reason: string }[] = [];
	const queue = [...chosen];
	while (queue.length) {
		const k = queue.shift()!;
		for (const imp of byKey.get(k)?.implies ?? []) {
			if (!byKey.has(imp.scope) || result.has(imp.scope)) continue;
			result.add(imp.scope);
			implied.push({ scope: imp.scope, by: k, reason: imp.reason });
			queue.push(imp.scope);
		}
	}
	return { scopes: all.map((s) => s.key).filter((k) => result.has(k)), implied, unknown };
}

const tableKey = (schema: string, table: string) => `${schema}.${table}`;

/**
 * Tabellen der (aufgelösten) Bereiche in Einfüge-Reihenfolge: zuerst Core (FK-sortiert), dann die
 * Module mit ihren Abhängigkeiten zuerst (je Modul `public.file`-Anteil, dann FK-sortierte Tabellen).
 * Dieselbe Tabelle mit gleichem Filter wird nur einmal geplant. Nicht vorhandene Tabellen entfallen.
 * Unbekannte Core-Bereiche oder ungültige Modul-IDs → Error.
 */
export async function planTables(
	db: DbOrTx,
	scopes: string[]
): Promise<{ tables: PlannedTable[]; info: TableInfo[] }> {
	const coreScopes: CoreScopeKey[] = [];
	const moduleIds: string[] = [];
	for (const s of [...new Set(scopes)]) {
		if (s.startsWith('core:')) {
			if (!isCoreScope(s)) throw new Error(`Unbekannter Bereich: ${s}`);
			coreScopes.push(s);
		} else {
			if (!MODULE_ID_PATTERN.test(s)) throw new Error(`Ungültige Modul-ID: ${s}`);
			moduleIds.push(s);
		}
	}
	const modOrder = moduleInsertOrder(moduleIds.map((id) => ({ id, deps: moduleDeps(id) })));
	const schemaNames = ['public', ...modOrder.map((id) => moduleSchemaName(id))];
	const info = await loadTableInfo(db, schemaNames);
	const infoByKey = new Map(info.map((t) => [tableKey(t.schema, t.table), t]));

	const out: PlannedTable[] = [];
	const seen = new Set<string>();
	const used = new Map<string, TableInfo>();
	const add = (block: PlannedTable[]) => {
		const infos = block.map((p) => infoByKey.get(tableKey(p.schema, p.table))!);
		const order = sortTablesForInsert(infos);
		for (const t of order) {
			used.set(tableKey(t.schema, t.table), t);
			for (const p of block) {
				if (p.schema !== t.schema || p.table !== t.table) continue;
				const k = `${tableKey(p.schema, p.table)}|${p.where ?? ''}`;
				if (seen.has(k)) continue;
				seen.add(k);
				out.push(p);
			}
		}
	};

	// Core
	const coreBlock: PlannedTable[] = [];
	for (const s of coreScopes) {
		for (const t of CORE_SCOPES[s].tables) {
			if (!infoByKey.has(tableKey('public', t.table))) continue;
			coreBlock.push({
				scope: s,
				schema: 'public',
				table: t.table,
				...(t.where ? { where: t.where } : {})
			});
		}
	}
	add(coreBlock);

	// Module
	for (const id of modOrder) {
		const schemaName = moduleSchemaName(id);
		const block: PlannedTable[] = [];
		if (infoByKey.has('public.file')) {
			block.push({ scope: id, schema: 'public', table: 'file', where: `module_id = '${id}'` });
		}
		for (const t of info) {
			if (t.schema !== schemaName || !IDENTIFIER.test(t.table)) continue;
			block.push({ scope: id, schema: schemaName, table: t.table });
		}
		add(block);
	}

	return { tables: out, info: [...used.values()] };
}
