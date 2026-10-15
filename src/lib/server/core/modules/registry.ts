import { PERMISSION_PATTERN } from '../permissions/catalog';
import { errors } from '../errors';
import { MODULE_ID_PATTERN, RESERVED_MODULE_IDS, type ModuleDefinition } from './types';

/**
 * Build-Zeit-Registrierung. Hier wird nur bekannt gemacht, WELCHE Module im Build enthalten
 * sind. Ob ein Modul laufzeitseitig aktiv ist, entscheidet `module_state` (siehe state.ts).
 */
const definitions = new Map<string, ModuleDefinition>();

export function validateDefinition(def: ModuleDefinition): void {
	const m = def.manifest;
	if (!MODULE_ID_PATTERN.test(m.id) || RESERVED_MODULE_IDS.has(m.id)) {
		throw new Error(`Ungueltige Modul-ID: "${m.id}"`);
	}
	if (!/^\d+\.\d+\.\d+/.test(m.version)) {
		throw new Error(`Modul ${m.id}: Version muss SemVer sein`);
	}
	for (const p of m.permissions) {
		if (!PERMISSION_PATTERN.test(p) || !p.startsWith(`${m.id}.`)) {
			throw new Error(
				`Modul ${m.id}: Berechtigung "${p}" muss dem Schema ${m.id}.ressource.aktion folgen`
			);
		}
	}
	for (const s of def.settings ?? []) {
		if (!s.key.startsWith(`${m.id}.`)) {
			throw new Error(`Modul ${m.id}: Einstellung "${s.key}" muss mit "${m.id}." beginnen`);
		}
	}
	for (const n of m.navigation) {
		if (!n.path.startsWith(`/modules/${m.id}`)) {
			throw new Error(`Modul ${m.id}: Navigationspfad muss unter /modules/${m.id} liegen`);
		}
	}
}

export function registerModule(def: ModuleDefinition): void {
	validateDefinition(def);
	if (definitions.has(def.manifest.id)) {
		throw new Error(`Modul "${def.manifest.id}" ist bereits registriert`);
	}
	definitions.set(def.manifest.id, def);
}

export function unregisterModule(id: string): void {
	definitions.delete(id);
}

export function getDefinition(id: string): ModuleDefinition | undefined {
	return definitions.get(id);
}

export function allDefinitions(): ModuleDefinition[] {
	return [...definitions.values()];
}

/** Topologische Pruefung: unbekannte Abhaengigkeiten und Zyklen werden abgelehnt. */
export function assertDependenciesResolvable(): void {
	for (const d of definitions.values()) {
		for (const dep of d.manifest.dependencies) {
			if (!definitions.has(dep)) {
				throw new Error(`Modul ${d.manifest.id} benoetigt unbekanntes Modul "${dep}"`);
			}
		}
	}
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (id: string, trail: string[]) => {
		if (done.has(id)) return;
		if (visiting.has(id))
			throw new Error(`Zyklische Modulabhaengigkeit: ${[...trail, id].join(' -> ')}`);
		visiting.add(id);
		for (const dep of definitions.get(id)?.manifest.dependencies ?? []) visit(dep, [...trail, id]);
		visiting.delete(id);
		done.add(id);
	};
	for (const id of definitions.keys()) visit(id, []);
}

export function requireDefinition(id: string): ModuleDefinition {
	const d = definitions.get(id);
	if (!d) throw errors.notFound(`Modul "${id}" ist nicht installiert`);
	return d;
}
