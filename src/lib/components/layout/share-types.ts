/** Gemeinsame Typen der Freigabe-Bausteine (ShareDialog, ShareMenu, SharePanel). */
export interface ShareEntry {
	userId: string;
	name: string;
	email?: string | null;
	level: string;
}

export interface ShareCandidate {
	id: string;
	name: string;
	email?: string | null;
}

export interface ShareLevel {
	value: string;
	label: string;
}

/** Eigentuemer*in: wird in der Zugriffsliste zuerst und ohne Bearbeitung angezeigt. */
export interface ShareOwner {
	name: string;
	email?: string | null;
}
