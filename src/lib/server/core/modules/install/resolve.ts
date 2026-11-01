/**
 * Abhängigkeiten eines Installationswunschs auflösen (geschlossene Hülle über harte Abhängigkeiten).
 * Kandidaten je fehlender Abhängigkeit, in dieser Reihenfolge: dasselbe Repository/Katalog → `source`-Link im
 * Paket der anfordernden Moduls → (Phase 7) früherer Lock-Eintrag. Installierte Module in passender Version
 * bleiben unverändert. Optionale Abhängigkeiten werden nur empfohlen.
 */
import { t } from '$lib/i18n';
import { versionSatisfies, type ModulePackage } from '../package/schema';
import { allDefinitions, getDefinition, getModulePackage } from '../registry';
import type { DiscoveredModule } from './discover';

/** Herkunft eines Kandidaten (für Lock und Anzeige) */
export type CandidateOrigin =
	| { type: 'github'; owner: string; repo: string; path: string; ref: string; sha: string }
	| { type: 'upload'; fileName: string; zipSha256: string; path: string };

export interface Candidate {
	mod: DiscoveredModule;
	origin: CandidateOrigin;
}

export interface PlanEntry extends Candidate {
	/** `selected`: ausgewählt; `dependency`: als Abhängigkeit von `requiredBy` nötig */
	reason: 'selected' | 'dependency';
	requiredBy: string[];
}

export interface ResolvedPlan {
	entries: PlanEntry[];
	/** Erfüllte Abhängigkeiten durch bereits installierte Module */
	satisfied: { id: string; version: string; requiredBy: string }[];
	/** Optionale Abhängigkeiten, die fehlen; `available` = im selben Repository vorhanden */
	recommended: { id: string; requiredBy: string; available: boolean }[];
	blockers: string[];
}

/** Fremdquelle laden (GitHub über `source`-Link); `null` = nicht gefunden */
export type SourceLoader = (source: string, wantedId: string) => Promise<Candidate | null>;

export async function resolvePlan(
	selected: string[],
	repo: Candidate[],
	loadSource: SourceLoader
): Promise<ResolvedPlan> {
	const byId = new Map(repo.map((c) => [c.mod.id, c]));
	const entries = new Map<string, PlanEntry>();
	const satisfied: ResolvedPlan['satisfied'] = [];
	const recommended: ResolvedPlan['recommended'] = [];
	const blockers: string[] = [];

	for (const id of selected) {
		const c = byId.get(id);
		if (!c) blockers.push(t('install.resolve.notInSource', { id }));
		else entries.set(id, { ...c, reason: 'selected', requiredBy: [] });
	}

	const queue = [...entries.keys()];
	while (queue.length) {
		const id = queue.shift()!;
		const entry = entries.get(id)!;
		const pkg = entry.mod.pkg;
		for (const [dep, { version: range, source }] of Object.entries(pkg.dependencies)) {
			const planned = entries.get(dep);
			if (planned) {
				if (!planned.requiredBy.includes(id)) planned.requiredBy.push(id);
				if (!versionSatisfies(planned.mod.pkg.version, range)) {
					blockers.push(
						t('install.resolve.plannedMismatch', {
							id: pkg.id,
							dep,
							range,
							version: planned.mod.pkg.version
						})
					);
				}
				continue;
			}
			const installed = getDefinition(dep);
			if (installed && versionSatisfies(installed.manifest.version, range)) {
				satisfied.push({ id: dep, version: installed.manifest.version, requiredBy: id });
				continue;
			}
			let candidate: Candidate | null = byId.get(dep) ?? null;
			if (!candidate && source) {
				try {
					candidate = await loadSource(source, dep);
				} catch (e) {
					blockers.push(
						t('install.resolve.loadFailed', {
							dep,
							id: pkg.id,
							source,
							error: e instanceof Error ? e.message : String(e)
						})
					);
					continue;
				}
			}
			if (!candidate) {
				blockers.push(
					installed
						? t('install.resolve.installedNoSource', {
								id: pkg.id,
								dep,
								range,
								version: installed.manifest.version
							})
						: t('install.resolve.missingNoSource', { id: pkg.id, dep, range })
				);
				continue;
			}
			if (!versionSatisfies(candidate.mod.pkg.version, range)) {
				blockers.push(
					t('install.resolve.sourceMismatch', {
						id: pkg.id,
						dep,
						range,
						version: candidate.mod.pkg.version
					})
				);
				continue;
			}
			entries.set(dep, { ...candidate, reason: 'dependency', requiredBy: [id] });
			queue.push(dep);
		}
		for (const dep of Object.keys(pkg.optionalDependencies)) {
			if (entries.has(dep) || getDefinition(dep)) continue;
			if (!recommended.some((r) => r.id === dep)) {
				recommended.push({ id: dep, requiredBy: id, available: byId.has(dep) });
			}
		}
	}

	// Zyklen über harte Abhängigkeiten (geplante + installierte Module)
	const depsOf = (id: string): string[] => {
		const planned = entries.get(id)?.mod.pkg;
		if (planned) return Object.keys(planned.dependencies);
		return getDefinition(id)?.manifest.dependencies ?? [];
	};
	const visiting = new Set<string>();
	const done = new Set<string>();
	const visit = (id: string, trail: string[]): void => {
		if (done.has(id)) return;
		if (visiting.has(id)) {
			blockers.push(t('install.resolve.cycle', { trail: [...trail, id].join(' → ') }));
			return;
		}
		visiting.add(id);
		for (const d of depsOf(id)) visit(d, [...trail, id]);
		visiting.delete(id);
		done.add(id);
	};
	for (const id of entries.keys()) visit(id, []);

	// Rückwärts: installierte Module, die ein Update nicht mehr vertragen
	for (const e of entries.values()) {
		if (!getDefinition(e.mod.id)) continue;
		for (const other of allDefinitions()) {
			if (entries.has(other.manifest.id)) continue;
			const range = getModulePackage(other.manifest.id)?.dependencies[e.mod.id]?.version;
			if (range && !versionSatisfies(e.mod.pkg.version, range)) {
				blockers.push(
					t('install.resolve.reverse', {
						other: other.manifest.id,
						id: e.mod.id,
						range,
						version: e.mod.pkg.version
					})
				);
			}
		}
	}

	// Abhängigkeiten zuerst (für Anzeige und spätere Aktivierung)
	const order: string[] = [];
	const placed = new Set<string>();
	const place = (id: string, seen = new Set<string>()) => {
		if (placed.has(id) || seen.has(id) || !entries.has(id)) return;
		seen.add(id);
		for (const d of depsOf(id)) place(d, seen);
		placed.add(id);
		order.push(id);
	};
	for (const id of entries.keys()) place(id);
	return {
		entries: order.map((id) => entries.get(id)!),
		satisfied,
		recommended,
		blockers: [...new Set(blockers)]
	};
}

export type { ModulePackage };
