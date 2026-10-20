/** Antwort von `GET /dashboard/core` – Felder fehlen, wenn das Recht fehlt. */
export interface CoreDashboardData {
	/** Aktive Benutzer*innen (`core.users.view`) */
	users?: number;
	/** Aktive Module (`core.modules.view`) */
	modules?: number;
	/** Nicht widerrufene API-Keys (`core.api.view`) */
	apiKeys?: number;
	/** Letzte Audit-Einträge (`core.audit.view`) */
	recent?: CoreActivityEntry[];
}

export interface CoreActivityEntry {
	id: string;
	action: string;
	actorName: string | null;
	target: string | null;
	/** ISO-Zeitstempel */
	createdAt: string;
}

/** Wie lange ein laufender/fertiger Abruf geteilt wird (mehrere Kacheln → ein Request) */
const SHARE_MS = 5_000;
let cached: { at: number; promise: Promise<CoreDashboardData> } | null = null;

/**
 * Lädt die Core-Kennzahlen einmal für alle Core-Kacheln. `fresh` erzwingt einen neuen Abruf
 * („Erneut versuchen“); Fehler werden nicht zwischengespeichert.
 */
export function loadCoreDashboard(fresh = false): Promise<CoreDashboardData> {
	if (!fresh && cached && Date.now() - cached.at < SHARE_MS) return cached.promise;
	const promise = fetch('/dashboard/core', { headers: { accept: 'application/json' } }).then(
		async (res) => {
			if (!res.ok) throw new Error('Die Übersicht konnte nicht geladen werden.');
			return ((await res.json()) as { data: CoreDashboardData }).data;
		}
	);
	const entry = { at: Date.now(), promise };
	cached = entry;
	promise.catch(() => {
		if (cached === entry) cached = null;
	});
	return promise;
}
