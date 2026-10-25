/**
 * Gemeinsame Typen der Freigabe an „Principals“ (Server und Client).
 *
 * Ein Principal ist, wem ein Objekt freigegeben wird: der ganze Stamm (`everyone`), eine Gruppe
 * aus `members` (`group`), eine Berechtigungsrolle (`role`), ein Benutzerkonto (`user`) oder ein
 * Mitglied aus `members` (`member`, wirkt über die mit ihm verknüpften Konten).
 */

import type { RequestContext } from './index';

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

/** Gruppe aus `members` für Auswahl/Freigaben anderer Module (einzige Quelle; `members` nutzt denselben Typ) */
export interface PrincipalGroupRef {
	id: string;
	name: string;
	color: string | null;
	/** Gruppenbild (`/api/v1/modules/members/groups/<id>/image?v=…`) oder `null`; Abruf braucht `members.group.view` */
	image: string | null;
	/** Gruppenstunde: 1 = Mo … 7 = So (je `null`, wenn nicht hinterlegt) */
	meetingWeekday: number | null;
	/** Beginn der Gruppenstunde `HH:MM` */
	meetingTime: string | null;
	/** Ende der Gruppenstunde `HH:MM` */
	meetingEndTime: string | null;
	meetingPlace: string | null;
}

/** Mitglied für die Freigabe-Suche (Name = „Vorname Nachname“) */
export interface PrincipalMemberRef {
	id: string;
	name: string;
	groups: { id: string; name: string }[];
}

/**
 * Was `members` für Freigaben anbietet. **Einzige Quelle** des Vertrags: `members/contract.ts`
 * (`MembersService extends PrincipalProvider`) und `members/principals.service.ts`
 * (`satisfies PrincipalProvider`) bauen darauf auf, das SDK importiert keine Module.
 */
export interface PrincipalProvider {
	/** Alle Gruppen nach Name, ohne Rechteprüfung (nur Name, Farbe, Gruppenstunde) */
	listGroups(): Promise<PrincipalGroupRef[]>;
	/**
	 * Mitglieder, die mit dem Konto verknüpft sind (ohne ausgetretene), und deren Gruppen
	 * (Mitgliedschaft UND Leitung). Ohne Rechteprüfung (dient der Zugriffsprüfung selbst).
	 */
	principalIdsForUser(userId: string): Promise<{ memberIds: string[]; groupIds: string[] }>;
	/**
	 * Mitglieder für Freigaben **mit** Rechteprüfung: ohne `members.member.view` (System-Kontext
	 * ausgenommen) → `[]`. `search` (ab 2 Zeichen, ohne ausgetretene) oder `ids` (≤ 100, auch
	 * ausgetretene); max. `limit` (Standard 20, höchstens 30).
	 */
	searchMemberPrincipals(
		ctx: RequestContext,
		query: { search?: string; ids?: string[]; limit?: number }
	): Promise<PrincipalMemberRef[]>;
	/**
	 * Konten hinter Mitglieds- und Gruppen-Freigaben (für Benachrichtigungen), ohne Rechteprüfung:
	 * mit den Mitgliedern verknüpfte Konten bzw. bei Gruppen die Konten ihrer (nicht ausgetretenen)
	 * Mitglieder und Leitungen. Höchstens 50 Gruppen und 2000 Mitglieder.
	 */
	userIdsForPrincipals(input: { memberIds: string[]; groupIds: string[] }): Promise<string[]>;
}
