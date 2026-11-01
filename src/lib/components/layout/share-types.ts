/**
 * Gemeinsame Typen der Freigabe-Bausteine (ShareDialog, ShareMenu, SharePanel).
 *
 * Ohne `type` ist ein Eintrag ein Benutzerkonto (bisheriges Verhalten, Schlüssel = `userId`).
 * Mit `type` (alle, Gruppe, Rolle, Benutzer*in, Mitglied) ist der Schlüssel `typ:id`
 * (siehe `shareKey`); diesen Schlüssel bekommen `onchange`/`onremove`.
 */
export type ShareTargetType = 'everyone' | 'group' | 'role' | 'user' | 'member';

export interface ShareEntry {
	/** ID des Ziels (bei Benutzern ohne `type`: Benutzer-ID) */
	userId: string;
	type?: ShareTargetType;
	name: string;
	email?: string | null;
	/** Unterzeile statt E-Mail (z. B. Gruppen eines Mitglieds) */
	detail?: string | null;
	/** Farbe einer Gruppe (`#rrggbb`) */
	color?: string | null;
	/** Profil- bzw. Gruppenbild (Avatar), sonst Initialen */
	image?: string | null;
	level: string;
}

export interface ShareCandidate {
	id: string;
	type?: ShareTargetType;
	name: string;
	email?: string | null;
	detail?: string | null;
	color?: string | null;
	image?: string | null;
}

export interface ShareLevel {
	value: string;
	label: string;
}

/** Eigentümer*in: wird in der Zugriffsliste zuerst und ohne Bearbeitung angezeigt. */
export interface ShareOwner {
	name: string;
	email?: string | null;
	/** Profilbild (Avatar), sonst Initialen */
	image?: string | null;
}

/** Initialen für Avatare (höchstens zwei; Wörter ohne Buchstaben/Ziffer am Anfang zählen nicht) */
export function shareInitials(name: string): string {
	return (
		name
			.split(/\s+/)
			.filter((p) => /^[\p{L}\p{N}]/u.test(p))
			.slice(0, 2)
			.map((p) => p[0]!.toUpperCase())
			.join('') || '?'
	);
}

/** Schlüssel eines Eintrags/Kandidaten: `typ:id` mit Typ, sonst die reine ID. */
export function shareKey(e: { type?: ShareTargetType; id?: string; userId?: string }): string {
	const id = e.id ?? e.userId ?? '';
	return e.type ? `${e.type}:${id}` : id;
}
