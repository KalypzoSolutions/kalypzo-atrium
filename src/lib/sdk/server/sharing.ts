/**
 * Freigabe an Principals (Stamm, Gruppen, Rollen, Benutzer, Mitglieder) für Module.
 *
 * Muster je Modul (Tabelle im Modulschema):
 *   <obj>_shares(<obj>_id text, principal_type text, principal_id text, level text,
 *                created_by text, created_at timestamptz, PRIMARY KEY (<obj>_id, principal_type, principal_id))
 *
 * Ablauf im Handler:
 *   const keys = await principalKeysFor(ctx, MODULE_ID);        // VOR der Transaktion (PGlite)
 *   await core.database.forModule(MODULE_ID).transaction(tx => … principalMatchSql('s', keys) …);
 *
 * Gruppen und Mitglieder kommen aus dem Modul `members` (`PrincipalProvider`). Das aufrufende Modul
 * muss `members` in `optionalDependencies` (oder `dependencies`) führen; ist `members` nicht aktiv,
 * entfallen Gruppen und Mitglieder still.
 *
 * Alle Funktionen hier rufen Core-Dienste auf: nie innerhalb einer offenen Modul-Transaktion.
 */
import { sql, type SQL } from 'drizzle-orm';
import { core } from '$lib/server/core';
import { errors } from '$lib/server/core/errors';
import type { RequestContext } from '$lib/sdk/types';
import {
	EVERYONE_ID,
	PRINCIPAL_TYPES,
	principalKey,
	type Principal,
	type PrincipalInfo,
	type PrincipalType
} from '$lib/sdk/types/sharing';

export type { Principal, PrincipalInfo, PrincipalType } from '$lib/sdk/types/sharing';
export {
	EVERYONE_ID,
	PRINCIPAL_TYPES,
	PRINCIPAL_TYPE_LABELS,
	parsePrincipalKey,
	principalKey
} from '$lib/sdk/types/sharing';

/**
 * Was `members` für Freigaben anbietet (Teilmenge von `MembersService`, siehe
 * `members/contract.ts`). Hier dupliziert, weil das SDK keine Module importiert.
 */
export interface PrincipalProvider {
	/** Alle Gruppen (Name sortiert) */
	listGroups(): Promise<
		{
			id: string;
			name: string;
			color: string | null;
			/** Gruppenbild-Adresse oder `null` */
			image?: string | null;
			/** Gruppenstunde: 1 = Mo … 7 = So */
			meetingWeekday?: number | null;
			meetingTime?: string | null;
			meetingPlace?: string | null;
		}[]
	>;
	/**
	 * Mitglieder, die mit dem Konto verknüpft sind (ohne ausgetretene), und deren Gruppen
	 * (Mitgliedschaft UND Leitung).
	 */
	principalIdsForUser(userId: string): Promise<{ memberIds: string[]; groupIds: string[] }>;
	/** Mitglieder per Suche (ab 2 Zeichen) oder IDs; ohne ausgetretene bei Suche, max. `limit` (30) */
	searchMembers(query: {
		search?: string;
		ids?: string[];
		limit?: number;
	}): Promise<{ id: string; name: string; groups: { id: string; name: string }[] }[]>;
}

export interface PrincipalOptions {
	/** Anzeigename für `everyone`, z. B. „Stamm Edelweißpiraten“ */
	everyoneLabel: string;
	/** Erlaubte Typen (Standard: alle) */
	types?: readonly PrincipalType[];
	/** Max. Treffer je Typ bei der Suche (Standard 10) */
	limitPerType?: number;
}

const ALIAS_RE = /^[a-z_][a-z0-9_]*$/;
const MIN_SEARCH = 2;
const DEFAULT_LIMIT_PER_TYPE = 10;
/** Obergrenze der Verzeichnisse (`users.directory`, `searchMembers`) je Aufruf */
const DIRECTORY_CHUNK = 30;
const EVERYONE_KEY = `everyone:${EVERYONE_ID}`;

type Display = Omit<PrincipalInfo, 'type' | 'id'>;

function membersProvider(moduleId: string): Promise<PrincipalProvider | null> {
	return core.modules.useOptional<PrincipalProvider>('members', moduleId);
}

function allowedTypes(types?: readonly PrincipalType[]): Set<PrincipalType> {
	return new Set(types ?? PRINCIPAL_TYPES);
}

function chunks<T>(list: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

function uniqueIds(list: readonly Principal[], type: PrincipalType): string[] {
	return [...new Set(list.filter((p) => p.type === type).map((p) => p.id))];
}

/**
 * Principal-Schlüssel des Aufrufers (`typ:id`): immer `everyone:*` (bei angemeldeter Identität),
 * `user:<id>`, alle `role:<id>`, sowie `member:<id>`/`group:<id>` über verknüpfte Mitglieder.
 * Ohne `userId` (z. B. System) nur `everyone:*`.
 */
export async function principalKeysFor(ctx: RequestContext, moduleId: string): Promise<string[]> {
	const userId = ctx.userId;
	if (!userId) return [EVERYONE_KEY];
	const keys = new Set<string>([EVERYONE_KEY, `user:${userId}`]);
	for (const id of await core.users.roleIds(userId)) keys.add(`role:${id}`);
	const members = await membersProvider(moduleId);
	if (members) {
		const { memberIds, groupIds } = await members.principalIdsForUser(userId);
		for (const id of memberIds) keys.add(`member:${id}`);
		for (const id of groupIds) keys.add(`group:${id}`);
	}
	return [...keys];
}

/**
 * SQL-Bedingung: Freigabezeile `alias` passt auf einen der Schlüssel.
 * Leere Liste → `FALSE`. `alias` muss ein einfacher SQL-Bezeichner sein.
 */
export function principalMatchSql(alias: string, keys: readonly string[]): SQL {
	if (!ALIAS_RE.test(alias)) throw new Error(`Ungültiger SQL-Alias: ${alias}`);
	if (keys.length === 0) return sql`FALSE`;
	const a = sql.raw(alias);
	const values = sql.join(
		keys.map((k) => sql`${k}`),
		sql`, `
	);
	return sql`((${a}.principal_type || ':' || ${a}.principal_id) IN (${values}))`;
}

/** Kandidaten für die Freigabe-Suche (ab 2 Zeichen), gemischt über alle erlaubten Typen. */
export async function searchPrincipals(
	ctx: RequestContext,
	moduleId: string,
	query: string,
	opts: PrincipalOptions
): Promise<PrincipalInfo[]> {
	const q = query.trim();
	if (q.length < MIN_SEARCH) return [];
	const needle = q.toLocaleLowerCase('de');
	const types = allowedTypes(opts.types);
	const limit = Math.min(Math.max(opts.limitPerType ?? DEFAULT_LIMIT_PER_TYPE, 1), DIRECTORY_CHUNK);
	const byType: Record<PrincipalType, PrincipalInfo[]> = {
		everyone: [],
		group: [],
		role: [],
		member: [],
		user: []
	};

	if (types.has('everyone')) {
		const hit = [opts.everyoneLabel, 'Stamm', 'alle'].some((s) =>
			s.toLocaleLowerCase('de').includes(needle)
		);
		if (hit) byType.everyone.push({ type: 'everyone', id: EVERYONE_ID, name: opts.everyoneLabel });
	}
	if (types.has('role')) {
		const roles = await core.roles.directory(ctx, { search: q, limit });
		byType.role = roles.slice(0, limit).map((r) => ({ type: 'role', id: r.id, name: r.name }));
	}
	if (types.has('user')) {
		const users = await core.users.directory(ctx, { search: q, limit });
		byType.user = users
			.slice(0, limit)
			.map((u) => ({ type: 'user', id: u.id, name: u.name, detail: u.email, image: u.image }));
	}
	if (types.has('group') || types.has('member')) {
		const members = await membersProvider(moduleId);
		if (members) {
			if (types.has('group')) {
				byType.group = (await members.listGroups())
					.filter((g) => g.name.toLocaleLowerCase('de').includes(needle))
					.slice(0, limit)
					.map((g) => ({
						type: 'group',
						id: g.id,
						name: g.name,
						color: g.color,
						image: g.image ?? null
					}));
			}
			if (types.has('member')) {
				byType.member = (await members.searchMembers({ search: q, limit }))
					.slice(0, limit)
					.map((m) => ({
						type: 'member',
						id: m.id,
						name: m.name,
						detail: m.groups.map((g) => g.name).join(', ') || null
					}));
			}
		}
	}
	return [...byType.everyone, ...byType.group, ...byType.role, ...byType.member, ...byType.user];
}

/** Gebündelte Auflösung: Schlüssel `typ:id` → Anzeigedaten (nur gefundene, nur erlaubte Typen) */
async function resolvePrincipals(
	ctx: RequestContext,
	moduleId: string,
	list: readonly Principal[],
	opts: { types?: readonly PrincipalType[]; everyoneLabel?: string }
): Promise<Map<string, Display>> {
	const types = allowedTypes(opts.types);
	const found = new Map<string, Display>();
	const ids = (type: PrincipalType) => (types.has(type) ? uniqueIds(list, type) : []);

	if (types.has('everyone') && list.some((p) => p.type === 'everyone' && p.id === EVERYONE_ID)) {
		found.set(EVERYONE_KEY, { name: opts.everyoneLabel ?? 'Stamm' });
	}
	for (const chunk of chunks(ids('user'), DIRECTORY_CHUNK)) {
		const users = await core.users.directory(ctx, { ids: chunk, limit: DIRECTORY_CHUNK });
		for (const u of users) {
			found.set(`user:${u.id}`, { name: u.name, detail: u.email, image: u.image });
		}
	}
	const roleIds = ids('role');
	if (roleIds.length) {
		for (const chunk of chunks(roleIds, DIRECTORY_CHUNK)) {
			const roles = await core.roles.directory(ctx, { ids: chunk, limit: chunk.length });
			for (const r of roles) found.set(`role:${r.id}`, { name: r.name });
		}
	}
	const groupIds = ids('group');
	const memberIds = ids('member');
	if (groupIds.length || memberIds.length) {
		const members = await membersProvider(moduleId);
		if (members) {
			if (groupIds.length) {
				const wanted = new Set(groupIds);
				for (const g of await members.listGroups()) {
					if (!wanted.has(g.id)) continue;
					found.set(`group:${g.id}`, { name: g.name, color: g.color, image: g.image ?? null });
				}
			}
			for (const chunk of chunks(memberIds, DIRECTORY_CHUNK)) {
				const rows = await members.searchMembers({ ids: chunk, limit: chunk.length });
				for (const m of rows) {
					found.set(`member:${m.id}`, {
						name: m.name,
						detail: m.groups.map((g) => g.name).join(', ') || null
					});
				}
			}
		}
	}
	return found;
}

/** Anzeigedaten zu gespeicherten Principals (Reihenfolge wie `list`; Unbekannte mit Name „Unbekannt“). */
export async function describePrincipals(
	ctx: RequestContext,
	moduleId: string,
	list: readonly Principal[],
	opts: PrincipalOptions
): Promise<PrincipalInfo[]> {
	if (list.length === 0) return [];
	const found = await resolvePrincipals(ctx, moduleId, list, opts);
	return list.map((p) => ({
		type: p.type,
		id: p.id,
		...(found.get(principalKey(p)) ?? { name: 'Unbekannt' })
	}));
}

/**
 * Prüft, dass alle Principals existieren und erlaubt sind; sonst `errors.validation`
 * (Pfad `[pathPrefix, index]`). `everyone` braucht die ID `*`.
 * `keep`: Schlüssel bereits gespeicherter Freigaben – werden ohne Prüfung akzeptiert, damit z. B.
 * nach dem Deaktivieren von `members` vorhandene Gruppenfreigaben ein Speichern nicht blockieren.
 */
export async function validatePrincipals(
	ctx: RequestContext,
	moduleId: string,
	list: readonly Principal[],
	opts: Pick<PrincipalOptions, 'types'> & {
		pathPrefix?: string;
		keep?: ReadonlySet<string>;
	} = {}
): Promise<void> {
	const keep = opts.keep ?? new Set<string>();
	const check = list.filter((p) => !keep.has(principalKey(p)));
	if (check.length === 0) return;
	const found = await resolvePrincipals(ctx, moduleId, check, { types: opts.types });
	const issues: { path: (string | number)[]; message: string }[] = [];
	list.forEach((p, index) => {
		if (!keep.has(principalKey(p)) && !found.has(principalKey(p))) {
			issues.push({
				path: [opts.pathPrefix ?? 'shares', index, 'id'],
				message: 'Unbekannt oder nicht erlaubt'
			});
		}
	});
	if (issues.length) throw errors.validation(issues);
}
