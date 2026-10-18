/**
 * Gemeinsame Typen der Freigabe an „Principals“ (Server und Client).
 *
 * Ein Principal ist, wem ein Objekt freigegeben wird: der ganze Stamm (`everyone`), eine Gruppe
 * aus `members` (`group`), eine Berechtigungsrolle (`role`), ein Benutzerkonto (`user`) oder ein
 * Mitglied aus `members` (`member`, wirkt über die mit ihm verknüpften Konten).
 */

export const PRINCIPAL_TYPES = ['everyone', 'group', 'role', 'user', 'member'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

/** Feste ID des Principals `everyone` */
export const EVERYONE_ID = '*';

export interface Principal {
	type: PrincipalType;
	id: string;
}

/** Principal mit Anzeigedaten (Suche, Zugriffsliste) */
export interface PrincipalInfo extends Principal {
	name: string;
	/** Unterzeile, z. B. E-Mail, Gruppen eines Mitglieds */
	detail?: string | null;
	/** Farbe (`#rrggbb`), z. B. einer Gruppe */
	color?: string | null;
	/** Bild-Adresse (Profilbild einer Person, Gruppenbild), sonst Initialen */
	image?: string | null;
}

export const PRINCIPAL_TYPE_LABELS: Record<PrincipalType, string> = {
	everyone: 'Stamm',
	group: 'Gruppe',
	role: 'Rolle',
	user: 'Benutzer*in',
	member: 'Mitglied'
};

/** Eindeutiger Schlüssel `typ:id` (z. B. `group:abc`, `everyone:*`) */
export function principalKey(p: Principal): string {
	return `${p.type}:${p.id}`;
}

export function parsePrincipalKey(key: string): Principal | null {
	const i = key.indexOf(':');
	if (i <= 0) return null;
	const type = key.slice(0, i) as PrincipalType;
	const id = key.slice(i + 1);
	if (!PRINCIPAL_TYPES.includes(type) || !id) return null;
	return { type, id };
}
