import type { DashboardWidget } from '$lib/sdk/types/module-ui';

/** Kachel mit Modul-ID (Ergebnis von `selectDashboardWidgets`). */
export interface ResolvedDashboardWidget extends DashboardWidget {
	/** `<moduleId>:<id>` – eindeutig über alle Module (Core-Kacheln: `core:<id>`) */
	key: string;
	moduleId: string;
}

/** Gespeicherte Anordnung je Benutzer (`core.user.dashboard`); `null` = Standard. */
export interface DashboardLayoutPref {
	/** Schlüssel in gewünschter Reihenfolge (unbekannte werden ignoriert) */
	order: string[];
	/** Ausgeblendete Schlüssel */
	hidden: string[];
}

/** Grenzen der gespeicherten Anordnung (Server und Client) */
export const DASHBOARD_LAYOUT_MAX = 100;
export const DASHBOARD_KEY_PATTERN = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

/**
 * Wählt die Kacheln aktiver Module: nur Module in `activeModules` (`core` ist immer aktiv), nur mit
 * vorhandenem Recht (`permission` und – falls gesetzt – mindestens eines aus `anyPermission`),
 * sortiert nach `order` (Standard 100), dann Modul-ID und Kachel-ID.
 * Reine Funktion (Unit-Test: `tests/unit/dashboard-widgets.test.ts`).
 */
export function selectDashboardWidgets(
	byModule: Record<string, readonly DashboardWidget[] | undefined>,
	activeModules: readonly string[],
	permissions: readonly string[]
): ResolvedDashboardWidget[] {
	const active = new Set([...activeModules, 'core']);
	const perms = new Set(permissions);
	const out: ResolvedDashboardWidget[] = [];
	for (const [moduleId, widgets] of Object.entries(byModule)) {
		if (!active.has(moduleId)) continue;
		for (const w of widgets ?? []) {
			if (w.permission && !perms.has(w.permission)) continue;
			if (w.anyPermission?.length && !w.anyPermission.some((p) => perms.has(p))) continue;
			out.push({ ...w, moduleId, key: `${moduleId}:${w.id}` });
		}
	}
	return out.sort(
		(a, b) =>
			(a.order ?? 100) - (b.order ?? 100) ||
			a.moduleId.localeCompare(b.moduleId) ||
			a.id.localeCompare(b.id)
	);
}

export interface ArrangedDashboard {
	/** Alle verfügbaren Kacheln in Anzeige-Reihenfolge (für „Anpassen“) */
	all: ResolvedDashboardWidget[];
	/** Davon sichtbar */
	visible: ResolvedDashboardWidget[];
	/** Schlüssel der ausgeblendeten Kacheln */
	hidden: Set<string>;
}

/**
 * Wendet die gespeicherte Anordnung an: gespeicherte Reihenfolge zuerst, neue (noch nicht
 * einsortierte) Kacheln an ihrer Standard-Position relativ zueinander dahinter; unbekannte
 * Schlüssel entfallen. Ohne Einstellung gelten Standard-Reihenfolge und `defaultHidden`.
 * Neue Kacheln mit `defaultHidden` bleiben auch bei vorhandener Einstellung aus.
 */
export function applyDashboardLayout(
	widgets: readonly ResolvedDashboardWidget[],
	pref: DashboardLayoutPref | null | undefined
): ArrangedDashboard {
	const byKey = new Map(widgets.map((w) => [w.key, w]));
	const ordered: ResolvedDashboardWidget[] = [];
	const seen = new Set<string>();
	for (const key of pref?.order ?? []) {
		const w = byKey.get(key);
		if (w && !seen.has(key)) {
			ordered.push(w);
			seen.add(key);
		}
	}
	for (const w of widgets) if (!seen.has(w.key)) ordered.push(w);

	const known = new Set(pref?.order ?? []);
	const hidden = new Set<string>();
	for (const w of ordered) {
		if (pref?.hidden.includes(w.key)) hidden.add(w.key);
		else if (w.defaultHidden && !known.has(w.key)) hidden.add(w.key);
	}
	return { all: ordered, visible: ordered.filter((w) => !hidden.has(w.key)), hidden };
}

/** Anordnung aus der aktuellen Liste und den ausgeblendeten Schlüsseln (zum Speichern). */
export function toDashboardLayout(
	all: readonly ResolvedDashboardWidget[],
	hidden: ReadonlySet<string>
): DashboardLayoutPref {
	const order = all.map((w) => w.key).slice(0, DASHBOARD_LAYOUT_MAX);
	return { order, hidden: order.filter((k) => hidden.has(k)) };
}
