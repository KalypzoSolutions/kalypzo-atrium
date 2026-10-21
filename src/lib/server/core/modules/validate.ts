import { CORE_PERMISSIONS } from '../permissions/catalog';
import type { ModuleDefinition } from './types';

/**
 * Prüfung der Manifest-Teile, die `validateDefinition` (registry.ts) nicht abdeckt und die teils
 * erst mit allen registrierten Modulen prüfbar sind (#76, 10-10). Bewusst ohne Import der Registry:
 * die Definitionen kommen als Parameter (Aufruf in `syncModules`, Tests direkt).
 *
 * Fehler (Ausnahme): unbekannte Rechte in `defaultRoleGrants`, `navigation[].permission`,
 * `search.permission|anyPermission`; ungültige oder doppelte `resetAreas`-IDs, leere Tabellenlisten,
 * `implies` auf unbekannte Bereiche registrierter Module. Ein `implies` auf ein **nicht registriertes**
 * Modul wird übersprungen (Modul nicht im Build, z. B. in Tests).
 *
 * Warnungen (Rückgabe): Zyklen über `optionalDependencies` (zusammen mit harten Abhängigkeiten),
 * z. B. `actions` → (optional) `treasury` → `actions`. Sie sind erlaubt, koppeln die Module aber
 * gegenseitig (10-08).
 */
export function validateModuleReferences(defs: readonly ModuleDefinition[]): string[] {
	const byId = new Map(defs.map((d) => [d.manifest.id, d]));
	const known = new Set<string>(Object.keys(CORE_PERMISSIONS));
	for (const d of defs) for (const p of d.manifest.permissions) known.add(p);

	for (const d of defs) {
		const m = d.manifest;
		const own = new Set(m.permissions);
		const grants = d.defaultRoleGrants ?? m.defaultRoleGrants ?? {};
		for (const [role, perms] of Object.entries(grants)) {
			if (!role.trim()) throw new Error(`Modul ${m.id}: defaultRoleGrants mit leerem Rollennamen`);
			for (const p of perms) {
				if (!own.has(p)) {
					throw new Error(
						`Modul ${m.id}: defaultRoleGrants["${role}"] enthält das Recht "${p}", das nicht im Manifest steht`
					);
				}
			}
		}
		for (const n of m.navigation) {
			for (const p of [n.permission, ...(n.anyPermission ?? [])]) {
				if (p && !known.has(p)) {
					throw new Error(
						`Modul ${m.id}: Navigation "${n.path}" verlangt unbekanntes Recht "${p}"`
					);
				}
			}
		}
		if (d.search) {
			for (const p of [d.search.permission, ...(d.search.anyPermission ?? [])]) {
				if (p !== undefined && !known.has(p)) {
					throw new Error(`Modul ${m.id}: search verlangt unbekanntes Recht "${p}"`);
				}
			}
		}
		const areaIds = new Set<string>();
		for (const a of d.resetAreas ?? []) {
			if (!/^[a-z][a-z0-9-]*$/.test(a.id) || areaIds.has(a.id)) {
				throw new Error(`Modul ${m.id}: ungültige oder doppelte Reset-Bereich-ID "${a.id}"`);
			}
			areaIds.add(a.id);
			if (!a.rebuild && !a.tables.length && !a.storagePrefixes) {
				throw new Error(`Modul ${m.id}: Reset-Bereich "${a.id}" löscht nichts`);
			}
		}
	}

	for (const d of defs) {
		for (const a of d.resetAreas ?? []) {
			for (const imp of a.implies ?? []) {
				const sep = imp.area.indexOf(':');
				const target = sep > 0 ? imp.area.slice(0, sep) : '';
				const areaId = sep > 0 ? imp.area.slice(sep + 1) : '';
				if (!target || !areaId) {
					throw new Error(
						`Modul ${d.manifest.id}: Reset-Bereich "${a.id}" impliziert "${imp.area}" (erwartet <modul>:<bereich>)`
					);
				}
				const targetDef = byId.get(target);
				if (!targetDef) continue; // Modul nicht registriert
				if (!(targetDef.resetAreas ?? []).some((x) => x.id === areaId)) {
					throw new Error(
						`Modul ${d.manifest.id}: Reset-Bereich "${a.id}" impliziert unbekannten Bereich "${imp.area}"`
					);
				}
			}
		}
	}

	return optionalCycleWarnings(defs);
}

/** Zyklen im Graphen aus harten und optionalen Abhängigkeiten, die mindestens eine optionale Kante enthalten */
function optionalCycleWarnings(defs: readonly ModuleDefinition[]): string[] {
	const ids = new Set(defs.map((d) => d.manifest.id));
	const edges = new Map<string, { to: string; optional: boolean }[]>();
	for (const d of defs) {
		edges.set(d.manifest.id, [
			...d.manifest.dependencies.filter((x) => ids.has(x)).map((to) => ({ to, optional: false })),
			...(d.manifest.optionalDependencies ?? [])
				.filter((x) => ids.has(x))
				.map((to) => ({ to, optional: true }))
		]);
	}
	const seen = new Set<string>();
	const warnings: string[] = [];
	const walk = (start: string, at: string, trail: string[], optional: boolean) => {
		for (const e of edges.get(at) ?? []) {
			const opt = optional || e.optional;
			if (e.to === start) {
				if (!opt) continue; // harte Zyklen lehnt assertDependenciesResolvable ab
				const cycle = [...trail, start];
				// gleiche Zyklen nur einmal melden (Rotation normalisieren)
				const body = cycle.slice(0, -1);
				const min = body.indexOf([...body].sort()[0]!);
				const key = [...body.slice(min), ...body.slice(0, min)].join('>');
				if (!seen.has(key)) {
					seen.add(key);
					warnings.push(
						`Gegenseitige Modulkopplung über optionale Abhängigkeit: ${cycle.join(' -> ')}`
					);
				}
				continue;
			}
			if (trail.includes(e.to)) continue;
			walk(start, e.to, [...trail, e.to], opt);
		}
	};
	for (const id of ids) walk(id, id, [id], false);
	return warnings;
}
