import { and, eq, sql } from 'drizzle-orm';
import type { ModuleManifest, RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema, type DbOrTx } from '../database/client';
import { MIGRATION_LOCK_KEY } from '../database/migrate';
import { errors } from '../errors';
import { CORE_PERMISSIONS } from '../permissions/catalog';
import { ensureDefaultRole } from '../permissions/default-roles';
import { requirePermission, syncPermissions } from '../permissions/service';
import {
	allDefinitions,
	brokenModules,
	excludeUnresolvableModules,
	getDefinition,
	requireDefinition
} from './registry';
import { enabledModuleIds, invalidateModuleStateCache } from './state';
import { canonicalChecksumFor, migrationChecksum } from './migration-checksum';
import { splitSqlStatements } from './split-sql';
import { validateModuleReferences } from './validate';
import { moduleSchemaName } from './types';

export interface ModuleInfo {
	manifest: ModuleManifest;
	enabled: boolean;
	installedVersion: string | null;
	/** Aktive Module, die von diesem abhängen */
	dependents: string[];
	missingDependencies: string[];
}

/** Warnungen aus `validateModuleReferences` nur einmal je Prozess ausgeben */
const warnedCouplings = new Set<string>();

/** Gleicht Registry (Build-Zeit) mit Datenbank (Laufzeit) ab. Beim Start aufzurufen. */
export async function syncModules(): Promise<void> {
	// Nicht lauffähige Module (Abhängigkeit/Version/Zyklus) ausschließen statt den Start abzubrechen
	excludeUnresolvableModules();
	const db = getDb();
	const defs = allDefinitions();
	// Manifest-Verweise (Rechte, Reset-Bereiche) gegen alle registrierten Module prüfen (#76, 10-10)
	for (const w of validateModuleReferences(defs)) {
		if (warnedCouplings.has(w)) continue;
		warnedCouplings.add(w);
		console.warn(`[modules] ${w}`);
	}
	for (const d of defs) {
		await db
			.insert(schema.moduleState)
			.values({ id: d.manifest.id, enabled: false, installedVersion: d.manifest.version })
			.onConflictDoUpdate({
				target: schema.moduleState.id,
				set: { installedVersion: d.manifest.version, updatedAt: new Date() }
			});
	}
	await syncPermissions([
		...Object.entries(CORE_PERMISSIONS).map(([key, description]) => ({
			key,
			moduleId: 'core',
			description
		})),
		...defs.flatMap((d) =>
			d.manifest.permissions.map((key) => ({
				key,
				moduleId: d.manifest.id,
				description: d.manifest.permissionDescriptions?.[key]
			}))
		)
	]);
	await applyDefaultRoleGrants(defs);
	invalidateModuleStateCache();
	// Bereits aktive Module: ausstehende Migrationen anwenden (Update-Szenario)
	const enabled = await enabledModuleIds(db);
	for (const d of defs) if (enabled.has(d.manifest.id)) await runModuleMigrations(d.manifest.id);
}

/**
 * Vergibt `defaultRoleGrants` einmalig je (Modul, Rolle, Recht). Rollen werden über ihre stabile Kennung
 * `role.system_key = 'default:<Name>'` gefunden oder angelegt (kein System, `permissions/default-roles.ts`);
 * eine gleichnamige Rolle ohne Kennung bekommt nichts. Unbekannte Rechte (nicht im Manifest) werden übersprungen.
 */
async function applyDefaultRoleGrants(defs: ReturnType<typeof allDefinitions>): Promise<void> {
	const db = getDb();
	for (const d of defs) {
		const moduleId = d.manifest.id;
		for (const [roleName, perms] of Object.entries(
			d.defaultRoleGrants ?? d.manifest.defaultRoleGrants ?? {}
		)) {
			const wanted = [...new Set(perms)].filter((p) => d.manifest.permissions.includes(p));
			if (!wanted.length) continue;
			const done = await db
				.select({ key: schema.roleGrantApplied.permissionKey })
				.from(schema.roleGrantApplied)
				.where(
					and(
						eq(schema.roleGrantApplied.moduleId, moduleId),
						eq(schema.roleGrantApplied.roleName, roleName)
					)
				);
			const doneKeys = new Set(done.map((r) => r.key));
			const todo = wanted.filter((p) => !doneKeys.has(p));
			if (!todo.length) continue;
			// Nur die Rolle mit Kennung `default:<Name>` – nie eine bloß gleichnamige (#67, 01a-07)
			const roleId = await ensureDefaultRole(roleName, db);
			if (!roleId) continue;
			await db
				.insert(schema.rolePermission)
				.values(todo.map((permissionKey) => ({ roleId, permissionKey })))
				.onConflictDoNothing();
			await db
				.insert(schema.roleGrantApplied)
				.values(todo.map((permissionKey) => ({ moduleId, roleName, permissionKey })))
				.onConflictDoNothing();
		}
	}
}

export async function listModules(): Promise<ModuleInfo[]> {
	const db = getDb();
	const rows = await db.select().from(schema.moduleState);
	const state = new Map(rows.map((r) => [r.id, r]));
	const defs = allDefinitions();
	return defs.map((d) => {
		const id = d.manifest.id;
		return {
			manifest: d.manifest,
			enabled: state.get(id)?.enabled ?? false,
			installedVersion: state.get(id)?.installedVersion ?? null,
			dependents: defs
				.filter((o) => o.manifest.dependencies.includes(id) && state.get(o.manifest.id)?.enabled)
				.map((o) => o.manifest.id),
			missingDependencies: d.manifest.dependencies.filter((dep) => !getDefinition(dep))
		};
	});
}

/** Module, die Daten oder einen Zustand haben, aber nicht laufen (Anzeige unter Administration → Module) */
export interface ModuleProblem {
	id: string;
	name: string;
	version: string | null;
	/** `broken`: gefunden, aber nicht geladen; `missing`: nicht mehr installiert, Zustand/Daten vorhanden */
	kind: 'broken' | 'missing';
	reason: string;
	/** War beim Ausfall aktiv (Daten bleiben erhalten, Funktionen fehlen) */
	enabled: boolean;
}

export async function listModuleProblems(): Promise<ModuleProblem[]> {
	const rows = await getDb().select().from(schema.moduleState);
	const state = new Map(rows.map((r) => [r.id, r]));
	const brokenList = brokenModules();
	const brokenIds = new Set(brokenList.map((b) => b.id));
	const problems: ModuleProblem[] = brokenList.map((b) => ({
		...b,
		version: b.version ?? state.get(b.id)?.installedVersion ?? null,
		kind: 'broken',
		enabled: state.get(b.id)?.enabled ?? false
	}));
	for (const r of rows) {
		if (getDefinition(r.id) || brokenIds.has(r.id)) continue;
		problems.push({
			id: r.id,
			name: r.id,
			version: r.installedVersion,
			kind: 'missing',
			reason: 'Nicht installiert – Daten und Einstellungen sind noch vorhanden',
			enabled: r.enabled
		});
	}
	return problems.sort((a, b) => a.id.localeCompare(b.id));
}

export async function isModuleEnabled(id: string): Promise<boolean> {
	if (id === 'core') return true;
	return (await enabledModuleIds()).has(id) && !!getDefinition(id);
}

/**
 * Dienste eines anderen Moduls abrufen (`ModuleDefinition.provides`). Der Aufrufer muss den Anbieter in
 * `manifest.dependencies` führen, der Anbieter muss registriert und aktiv sein. Der Aufruf erfolgt
 * AUSSERHALB offener Modul-Transaktionen (PGlite).
 */
export async function useModuleService<T>(providerId: string, callerId: string): Promise<T> {
	const caller = getDefinition(callerId);
	if (!caller?.manifest.dependencies.includes(providerId)) {
		throw new Error(`Modul ${callerId} deklariert keine Abhängigkeit von "${providerId}"`);
	}
	const provider = getDefinition(providerId);
	if (!provider?.provides) {
		throw new Error(`Modul ${providerId} stellt keine Dienste bereit`);
	}
	await assertModuleEnabled(providerId);
	return provider.provides as T;
}

/**
 * Wie `useModuleService`, aber für `manifest.optionalDependencies`: liefert `null`, wenn der Anbieter
 * nicht registriert oder nicht aktiv ist. Ebenfalls nur AUSSERHALB offener Modul-Transaktionen aufrufen.
 */
export async function useOptionalModuleService<T>(
	providerId: string,
	callerId: string
): Promise<T | null> {
	const caller = getDefinition(callerId);
	if (!caller?.manifest.optionalDependencies?.includes(providerId)) {
		throw new Error(
			`Modul ${callerId} deklariert keine optionale Abhängigkeit von "${providerId}"`
		);
	}
	const provider = getDefinition(providerId);
	if (!provider?.provides) return null;
	if (!(await isModuleEnabled(providerId))) return null;
	return provider.provides as T;
}

/** Wirft `module_disabled`; verhindert Zugriff über UI und API. */
export async function assertModuleEnabled(id: string): Promise<void> {
	if (!(await isModuleEnabled(id))) throw errors.moduleDisabled(id);
}

/**
 * Führt ausstehende Migrationen aus. `opts.only`: nur diese Namen (Datensicherung: Schema auf den
 * Stand der Sicherung bringen, danach ein zweiter Aufruf ohne `only` für neuere Migrationen).
 */
export async function runModuleMigrations(
	moduleId: string,
	tx?: DbOrTx,
	opts: { only?: ReadonlySet<string> } = {}
): Promise<string[]> {
	const def = requireDefinition(moduleId);
	const migrations = (def.migrations ?? []).filter((m) => !opts.only || opts.only.has(m.name));
	const schemaName = moduleSchemaName(moduleId);
	const run = async (t: DbOrTx): Promise<string[]> => {
		// Globale Sperre bis Transaktionsende: parallele Starts (Rolling-Update, zwei Replikas) wenden
		// dieselben Migrationen sonst gleichzeitig an. Der zweite Prozess wartet und sieht danach die
		// bereits eingetragenen Migrationen.
		await t.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`);
		await t.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`));
		const applied = await t
			.select()
			.from(schema.moduleMigration)
			.where(eq(schema.moduleMigration.moduleId, moduleId));
		const byName = new Map(applied.map((a) => [a.name, a]));
		const newlyApplied: string[] = [];
		for (const m of migrations) {
			// zeilenendenunabhängig (CRLF/LF), siehe migration-checksum.ts
			const checksum = migrationChecksum(m.sql);
			const prev = byName.get(m.name);
			if (prev) {
				if (prev.checksum === checksum) continue;
				if (!canonicalChecksumFor(prev.checksum, m.sql)) {
					throw new Error(`Migration ${moduleId}/${m.name} wurde nach Anwendung verändert`);
				}
				// Übergang: alte Prüfsumme (Roh- bzw. CRLF-Variante) auf den kanonischen Wert umstellen
				await t
					.update(schema.moduleMigration)
					.set({ checksum })
					.where(
						and(
							eq(schema.moduleMigration.moduleId, moduleId),
							eq(schema.moduleMigration.name, m.name)
						)
					);
				continue;
			}
			// Nur das Modulschema (ohne `public`): unqualifizierte Namen dürfen keine Core-Tabelle treffen
			await t.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}"`));
			// Einzeln ausführen: manche Treiber (PGlite) erlauben pro Aufruf nur ein Statement
			for (const statement of splitSqlStatements(m.sql)) await t.execute(sql.raw(statement));
			// Core-Tabellen (module_migration, danach module_state/audit_log) wieder erreichbar machen
			await t.execute(sql.raw('SET LOCAL search_path TO DEFAULT'));
			await t.insert(schema.moduleMigration).values({ moduleId, name: m.name, checksum });
			newlyApplied.push(m.name);
		}
		return newlyApplied;
	};
	if (tx) return run(tx);
	return getDb().transaction((t) => run(t));
}

export async function enableModule(ctx: RequestContext, id: string): Promise<void> {
	await requirePermission(ctx, 'core.modules.manage');
	const def = requireDefinition(id);
	const db = getDb();
	await db.transaction(async (tx) => {
		const enabled = await enabledModuleIds(tx);
		const missing = def.manifest.dependencies.filter((d) => !enabled.has(d));
		if (missing.length) {
			throw errors.conflict(`Abhängigkeiten nicht aktiv: ${missing.join(', ')}`);
		}
		await runModuleMigrations(id, tx);
		await tx
			.update(schema.moduleState)
			.set({ enabled: true, installedVersion: def.manifest.version, updatedAt: new Date() })
			.where(eq(schema.moduleState.id, id));
		await auditFromContext(ctx, 'core.module.enabled', { target: id }, tx);
	});
	invalidateModuleStateCache();
	await def.onEnable?.(ctx);
}

export async function disableModule(ctx: RequestContext, id: string): Promise<void> {
	await requirePermission(ctx, 'core.modules.manage');
	const def = requireDefinition(id);
	const db = getDb();
	await db.transaction(async (tx) => {
		const enabled = await enabledModuleIds(tx);
		const dependents = allDefinitions()
			.filter((d) => d.manifest.dependencies.includes(id) && enabled.has(d.manifest.id))
			.map((d) => d.manifest.id);
		if (dependents.length) {
			throw errors.conflict(`Wird von aktiven Modulen benötigt: ${dependents.join(', ')}`);
		}
		await tx
			.update(schema.moduleState)
			.set({ enabled: false, updatedAt: new Date() })
			.where(and(eq(schema.moduleState.id, id)));
		await auditFromContext(ctx, 'core.module.disabled', { target: id }, tx);
	});
	invalidateModuleStateCache();
	await def.onDisable?.(ctx);
}

/** Ohne `order`: hinter allen sortierten Einträgen. */
const DEFAULT_NAV_ORDER = 1000;

/**
 * Navigation für aktive Module, gefiltert nach Berechtigungen des Kontexts und sortiert nach `order`
 * (stabil, gleicher Wert → Reihenfolge der Registrierung).
 */
export async function navigationFor(ctx: RequestContext) {
	const enabled = await enabledModuleIds();
	const items = allDefinitions()
		.filter((d) => enabled.has(d.manifest.id))
		.flatMap((d) =>
			d.manifest.navigation
				.filter((n) =>
					n.anyPermission?.length
						? n.anyPermission.some((p) => ctx.permissions.has(p))
						: !n.permission || ctx.permissions.has(n.permission)
				)
				// Ohne explizite Berechtigung: mindestens eine Modulberechtigung nötig
				.filter(
					(n) =>
						n.permission ||
						n.anyPermission?.length ||
						d.manifest.permissions.length === 0 ||
						d.manifest.permissions.some((p) => ctx.permissions.has(p))
				)
				.map((n) => ({ ...n, moduleId: d.manifest.id, moduleName: d.manifest.name }))
		);
	return items.sort((a, b) => (a.order ?? DEFAULT_NAV_ORDER) - (b.order ?? DEFAULT_NAV_ORDER));
}
