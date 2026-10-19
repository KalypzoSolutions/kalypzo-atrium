import { and, eq, sql } from 'drizzle-orm';
import type { ModuleManifest, RequestContext } from '$lib/sdk/types';
import { auditFromContext } from '../audit/service';
import { getDb, schema, type DbOrTx } from '../database/client';
import { sha256 } from '../crypto';
import { errors } from '../errors';
import { newId } from '../util';
import { CORE_PERMISSIONS } from '../permissions/catalog';
import { syncPermissions } from '../permissions/service';
import {
	allDefinitions,
	assertDependenciesResolvable,
	getDefinition,
	requireDefinition
} from './registry';
import { enabledModuleIds, invalidateModuleStateCache } from './state';
import { splitSqlStatements } from './split-sql';
import { moduleSchemaName } from './types';

export interface ModuleInfo {
	manifest: ModuleManifest;
	enabled: boolean;
	installedVersion: string | null;
	/** Aktive Module, die von diesem abhängen */
	dependents: string[];
	missingDependencies: string[];
}

/** Gleicht Registry (Build-Zeit) mit Datenbank (Laufzeit) ab. Beim Start aufzurufen. */
export async function syncModules(): Promise<void> {
	assertDependenciesResolvable();
	const db = getDb();
	const defs = allDefinitions();
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
 * Vergibt `defaultRoleGrants` einmalig je (Modul, Rolle, Recht). Rollen werden per Name gesucht oder
 * angelegt (kein System). Unbekannte Rechte (nicht im Manifest) werden übersprungen.
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
			let [role] = await db
				.select({ id: schema.role.id })
				.from(schema.role)
				.where(eq(schema.role.name, roleName));
			if (!role) {
				await db
					.insert(schema.role)
					.values({
						id: newId(),
						name: roleName,
						description: 'Automatisch angelegt',
						isSystem: false
					})
					.onConflictDoNothing();
				[role] = await db
					.select({ id: schema.role.id })
					.from(schema.role)
					.where(eq(schema.role.name, roleName));
			}
			if (!role) continue;
			const roleId = role.id;
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

export async function runModuleMigrations(moduleId: string, tx?: DbOrTx): Promise<string[]> {
	const def = requireDefinition(moduleId);
	const migrations = def.migrations ?? [];
	const schemaName = moduleSchemaName(moduleId);
	const run = async (t: DbOrTx): Promise<string[]> => {
		await t.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`));
		const applied = await t
			.select()
			.from(schema.moduleMigration)
			.where(eq(schema.moduleMigration.moduleId, moduleId));
		const byName = new Map(applied.map((a) => [a.name, a]));
		const newlyApplied: string[] = [];
		for (const m of migrations) {
			const checksum = sha256(m.sql);
			const prev = byName.get(m.name);
			if (prev) {
				if (prev.checksum !== checksum) {
					throw new Error(`Migration ${moduleId}/${m.name} wurde nach Anwendung verändert`);
				}
				continue;
			}
			await t.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`));
			// Einzeln ausführen: manche Treiber (PGlite) erlauben pro Aufruf nur ein Statement
			for (const statement of splitSqlStatements(m.sql)) await t.execute(sql.raw(statement));
			await t.insert(schema.moduleMigration).values({ moduleId, name: m.name, checksum });
			newlyApplied.push(m.name);
		}
		return newlyApplied;
	};
	if (tx) return run(tx);
	return getDb().transaction((t) => run(t));
}

export async function enableModule(ctx: RequestContext, id: string): Promise<void> {
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

/** Navigation für aktive Module, gefiltert nach Berechtigungen des Kontexts. */
export async function navigationFor(ctx: RequestContext) {
	const enabled = await enabledModuleIds();
	return allDefinitions()
		.filter((d) => enabled.has(d.manifest.id))
		.flatMap((d) =>
			d.manifest.navigation
				.filter((n) => !n.permission || ctx.permissions.has(n.permission))
				// Ohne explizite Berechtigung: mindestens eine Modulberechtigung nötig
				.filter(
					(n) =>
						n.permission ||
						d.manifest.permissions.length === 0 ||
						d.manifest.permissions.some((p) => ctx.permissions.has(p))
				)
				.map((n) => ({ ...n, moduleId: d.manifest.id, moduleName: d.manifest.name }))
		);
}
