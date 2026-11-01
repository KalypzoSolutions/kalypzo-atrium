/**
 * Datensicherung – Bereiche (Core-Bereiche und Module) und ihre Tabellen.
 *
 * Core-Bereiche sind fest (`CORE_SCOPE_KEYS`); jedes registrierte Modul mit vorhandenem Schema
 * `mod_<id>` ist ein Bereich (alle Basistabellen + seine Zeilen in `public.file`).
 * Nie gesichert: `session`, `verification`, `push_subscription`, `notification_queue` (gerätegebunden/flüchtig), `permission`, `module_state`, `module_migration`, `drizzle.*`.
 */
import { sql } from 'drizzle-orm';
import { getDb, type DbOrTx } from '../database/client';
import { allDefinitions, getDefinition } from '../modules/registry';
import { isModuleEnabled } from '../modules/service';
import { MODULE_ID_PATTERN, moduleSchemaName } from '../modules/types';
import { IDENTIFIER, loadTableInfo, sortTablesForInsert } from './introspect';
import { CORE_SCOPE_KEYS, type BackupScopeInfo, type PlannedTable, type TableInfo } from './types';
import { localized, t } from '$lib/i18n';

type CoreScopeKey = (typeof CORE_SCOPE_KEYS)[number];

/** `label`/`description`/`reason` sind Textschlüssel (Übersetzung beim Gebrauch) */
interface CoreScopeDef {
	label: string;
	description: string;
	implies?: { scope: string; reason: string }[];
	/** Tabellen in `public` mit optionalem Zeilenfilter (nur Konstanten) */
	tables: { table: string; where?: string }[];
}

const CORE_SCOPES: Record<CoreScopeKey, CoreScopeDef> = {
	'core:users': {
		label: 'backup.scope.users.label',
		description: 'backup.scope.users.description',
		implies: [{ scope: 'core:api-keys', reason: 'backup.scope.users.impliesApiKeys' }],
		tables: [
			{ table: 'user' },
			{ table: 'account' },
			{ table: 'two_factor' },
			{ table: 'setting', where: `scope_id <> ''` },
			{ table: 'user_role' },
			{ table: 'user_role_grant' },
			{ table: 'user_permission' },
			{ table: 'notification_pref' },
			{ table: 'file', where: `module_id = 'core'` }
		]
	},
	'core:roles': {
		label: 'backup.scope.roles.label',
		description: 'backup.scope.roles.description',
		tables: [
			{ table: 'role' },
			{ table: 'role_permission' },
			{ table: 'role_grant_applied' },
			{ table: 'user_role' },
			{ table: 'user_role_grant' }
		]
	},
	'core:api-keys': {
		label: 'backup.scope.apiKeys.label',
		description: 'backup.scope.apiKeys.description',
		tables: [{ table: 'api_key' }]
	},
	'core:settings': {
		label: 'backup.scope.settings.label',
		description: 'backup.scope.settings.description',
		tables: [
			{ table: 'setting', where: `scope_id = ''` },
			{ table: 'module_install' },
			{ table: 'module_install_event' }
		]
	},
	'core:audit': {
		label: 'backup.scope.audit.label',
		description: 'backup.scope.audit.description',
		tables: [{ table: 'audit_log' }]
	},
	'core:api-log': {
		label: 'backup.scope.apiLog.label',
		description: 'backup.scope.apiLog.description',
		tables: [{ table: 'api_log' }]
	},
	'core:jobs': {
		label: 'backup.scope.jobs.label',
		description: 'backup.scope.jobs.description',
		tables: [{ table: 'job_run' }]
	},
	'core:ai-usage': {
		label: 'backup.scope.aiUsage.label',
		description: 'backup.scope.aiUsage.description',
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
		label: t(CORE_SCOPES[key].label),
		description: t(CORE_SCOPES[key].description),
		implies: (CORE_SCOPES[key].implies ?? []).map((i) => ({ scope: i.scope, reason: t(i.reason) })),
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
			label: localized(def.manifest.name),
			description: def.manifest.description
				? localized(def.manifest.description)
				: t('backup.scope.moduleDescription', { name: localized(def.manifest.name) }),
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
