import { t } from '$lib/i18n';
/**
 * Reine Hilfsfunktionen für den Admin-Reset (ohne Datenbank): Auflösung der Implikationen und
 * Löschreihenfolge der Module. Getestet in `tests/unit/reset-areas.test.ts`.
 */

export interface AreaNode {
	/** `core:<id>` oder `<modul>:<id>` */
	key: string;
	/** `core` oder Modul-ID */
	module: string;
	rebuild: boolean;
	implies: { area: string; reason: string }[];
}

export interface ResolvedAreas {
	/** Aufgelöste Bereiche in der Reihenfolge von `nodes` */
	areas: string[];
	/** Zusätzlich (nicht ausgewählt) aufgenommene Bereiche mit Auslöser und Grund */
	implied: { area: string; by: string; reason: string }[];
	/** Ausgewählte Schlüssel, die es nicht (oder nicht aktiv) gibt */
	unknown: string[];
}

/** Grund für implizierte Bereiche bei `rebuild` (in der aktuellen Sprache) */
export function rebuildReason(): string {
	return t('reset.rebuildReason');
}

/**
 * Effektive Implikationen eines Bereichs: deklarierte `implies` (nur bekannte Bereiche, z. B. aktive
 * Module) plus – bei `rebuild` – alle anderen Bereiche desselben Moduls.
 */
export function effectiveImplies(
	node: AreaNode,
	nodes: AreaNode[]
): { area: string; reason: string }[] {
	const known = new Set(nodes.map((n) => n.key));
	const out = new Map<string, string>();
	for (const i of node.implies) {
		if (i.area !== node.key && known.has(i.area) && !out.has(i.area)) out.set(i.area, i.reason);
	}
	if (node.rebuild) {
		for (const n of nodes) {
			if (n.module === node.module && n.key !== node.key && !out.has(n.key)) {
				out.set(n.key, rebuildReason());
			}
		}
	}
	return [...out].map(([area, reason]) => ({ area, reason }));
}

/** Löst die Auswahl transitiv auf. Implizierte Bereiche unbekannter/inaktiver Module entfallen. */
export function resolveAreas(selected: string[], nodes: AreaNode[]): ResolvedAreas {
	const byKey = new Map(nodes.map((n) => [n.key, n]));
	const unknown = [...new Set(selected.filter((k) => !byKey.has(k)))];
	const chosen = new Set(selected.filter((k) => byKey.has(k)));
	const included = new Set(chosen);
	const implied: ResolvedAreas['implied'] = [];
	const queue = [...chosen];
	while (queue.length) {
		const key = queue.shift()!;
		for (const i of effectiveImplies(byKey.get(key)!, nodes)) {
			if (included.has(i.area)) continue;
			included.add(i.area);
			implied.push({ area: i.area, by: key, reason: i.reason });
			queue.push(i.area);
		}
	}
	return { areas: nodes.filter((n) => included.has(n.key)).map((n) => n.key), implied, unknown };
}

/**
 * Löschreihenfolge: abhängige Module zuerst (z. B. treasury vor actions vor members). `deps` umfasst
 * `dependencies` und `optionalDependencies`; unbekannte Abhängigkeiten werden ignoriert.
 */
export function moduleDeleteOrder(mods: { id: string; deps: string[] }[]): string[] {
	const byId = new Map(mods.map((m) => [m.id, m]));
	const done = new Set<string>();
	const visiting = new Set<string>();
	const post: string[] = [];
	const visit = (id: string) => {
		if (done.has(id) || visiting.has(id)) return;
		visiting.add(id);
		for (const d of [...(byId.get(id)?.deps ?? [])].sort()) if (byId.has(d)) visit(d);
		visiting.delete(id);
		done.add(id);
		post.push(id);
	};
	for (const id of [...byId.keys()].sort()) visit(id);
	// Post-Order liefert Abhängigkeiten zuerst – zum Löschen umgekehrt
	return post.reverse();
}

/** Stabiler Schlüssel einer aufgelösten Bereichsliste (für den Token-Abgleich) */
export function areasFingerprint(areas: string[]): string {
	return [...new Set(areas)].sort().join('|');
}
