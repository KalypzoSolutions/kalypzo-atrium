/**
 * Freigabe an Principals (alle, Gruppen, Rollen, Benutzer, Mitglieder) für Module.
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
 * muss `members` in `dependencies` (harte Abhängigkeit, Abruf über `core.modules.use`) oder in
 * `optionalDependencies` (Abruf über `core.modules.useOptional`) führen; ist `members` bei optionaler
 * Abhängigkeit nicht aktiv, entfallen Gruppen und Mitglieder still. Fehlt jede Deklaration, ist das
 * ein Programmierfehler (`Error`).
 *
 * Datenschutz (Suche und Anzeige werten `ctx` aus):
 * - `member`: Namen/Gruppen von Mitgliedern (meist Kinder) nur mit `members.member.view`
 *   (prüft zusätzlich `members` selbst in `searchMemberPrincipals`). Ohne das Recht liefert die Suche
 *   keine Mitglieder und gespeicherte Mitglieds-Freigaben erscheinen nur als „Mitglied“.
 *   `validatePrincipals` prüft nur die Existenz (gibt nichts aus) und gilt daher unabhängig vom Recht.
 * - `user`: E-Mail-Adresse als `detail` nur mit `core.users.view`, sonst nur Name/Bild.
 * - `group`: Gruppennamen/-farben bleiben bewusst für alle Aufrufer sichtbar – sie sind keine
 *   personenbezogenen Daten, stehen ohnehin in `events` (`GET /groups`) und auf der Website und
 *   werden zum Teilen „mit meiner Gruppe“ gebraucht.
 *
 * Alle Funktionen hier rufen Core-Dienste auf: nie innerhalb einer offenen Modul-Transaktion.
 */
import { sql, type SQL } from 'drizzle-orm';
import { core } from '$lib/server/core';
import { errors } from '$lib/server/core/errors';
import { t } from '$lib/i18n';
import type { RequestContext } from '$lib/sdk/types';
import {
	EVERYONE_ID,
	PRINCIPAL_TYPES,
	principalKey,
	type Principal,
	type PrincipalInfo,
	type PrincipalProvider,
	type PrincipalType
} from '$lib/sdk/types/sharing';

export type {
	Principal,
	PrincipalGroupRef,
	PrincipalInfo,
	PrincipalMemberRef,
	PrincipalProvider,
	PrincipalType
} from '$lib/sdk/types/sharing';
export {
	EVERYONE_ID,
	PRINCIPAL_TYPES,
	PRINCIPAL_TYPE_LABELS,
	parsePrincipalKey,
	principalKey
} from '$lib/sdk/types/sharing';

export interface PrincipalOptions {
	/**
	 * Anzeigename für `everyone`, z. B. „Alle Mitglieder des Vereins“; ohne Angabe die Einstellung
	 * `core.org.everyoneLabel` bzw. „Alle“ (`defaultEveryoneLabel`).
	 */
	everyoneLabel?: string;
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

/** Recht, das E-Mail-Adressen in Suche/Anzeige freischaltet */
const USERS_VIEW = 'core.users.view';
/** Anzeige gespeicherter Mitglieds-Freigaben ohne `members.member.view` */
const hiddenMember = (): Display => ({ name: t('sharing.hiddenMember') });

/**
 * Bezeichnung der Freigabe an alle (`everyone`): Einstellung `core.org.everyoneLabel` (Profil-Module geben sie
 * per `settingDefaults` vor, z. B. „Stamm“), leer → „Alle“ in der Sprache der Anzeige.
 */
export async function defaultEveryoneLabel(): Promise<string> {
	try {
		const v = await core.settings.get<string>('core.org.everyoneLabel');
		if (typeof v === 'string' && v.trim()) return v.trim();
	} catch {
		// ohne Datenbank (Unit-Tests) gilt der Standard
	}
	return t('sharing.everyone');
}

/**
 * Dienst der Personenquelle (Modul mit `ModuleDefinition.principals`, z. B. Mitglieder & Gruppen) passend zur
 * Deklaration des Aufrufers: harte Abhängigkeit → `core.modules.use`, optionale → `core.modules.useOptional`
 * (`null`, wenn nicht aktiv). Keine Personenquelle installiert → `null` (nur alle, Rollen, Benutzer*innen).
 * Quelle installiert, aber vom Aufrufer nicht deklariert: `Error` (Programmierfehler).
 */
async function membersProvider(moduleId: string): Promise<PrincipalProvider | null> {
	const source = core.modules.principalSource();
	if (!source) return null;
	const manifest = core.modules.registered().find((m) => m.id === moduleId);
	if (manifest?.dependencies.includes(source.id)) {
		return core.modules.use<PrincipalProvider>(source.id, moduleId);
	}
	if (manifest?.optionalDependencies?.includes(source.id)) {
		return core.modules.useOptional<PrincipalProvider>(source.id, moduleId);
	}
	throw new Error(
		`Modul ${moduleId} nutzt Freigaben an Principals, führt "${source.id}" aber weder in dependencies noch in optionalDependencies`
	);
}

/** Recht, das Mitglieder in Freigabe-Suche/-Anzeige sichtbar macht (von der Personenquelle festgelegt) */
function canSeeMembers(ctx: RequestContext): boolean {
	const source = core.modules.principalSource();
	return !!source && core.permissions.has(ctx, source.memberViewPermission);
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
 * Konten hinter Freigaben (für Benachrichtigungen): `user` direkt, `role` über `core.roles.userIds`,
 * `member`/`group` über `members` (verknüpfte Konten der Mitglieder bzw. der Gruppenmitglieder und
 * Leitungen), `everyone` nur mit `everyone: true`. Es bleiben nur aktive Konten mit `permission`
 * (Leserecht des Moduls); `exclude` (z. B. die handelnde Person) fällt weg. Ohne Rechteprüfung des Aufrufers.
 */
export async function principalUserIds(
	moduleId: string,
	principals: readonly Principal[],
	opts: { permission: string; exclude?: (string | null | undefined)[]; everyone?: boolean }
): Promise<string[]> {
	const allowed = new Set(await core.permissions.usersWith(opts.permission));
	const out = new Set<string>();
	if (opts.everyone && principals.some((p) => p.type === 'everyone')) {
		for (const id of allowed) out.add(id);
	}
	for (const id of uniqueIds(principals, 'user')) out.add(id);
	const roleIds = uniqueIds(principals, 'role');
	if (roleIds.length) for (const id of await core.roles.userIds(roleIds)) out.add(id);
	const memberIds = uniqueIds(principals, 'member');
	const groupIds = uniqueIds(principals, 'group');
	if (memberIds.length || groupIds.length) {
		const provider = await membersProvider(moduleId);
		if (provider) {
			for (const id of await provider.userIdsForPrincipals({ memberIds, groupIds })) out.add(id);
		}
	}
	const excluded = new Set(opts.exclude?.filter((x): x is string => !!x));
	return [...out].filter((id) => allowed.has(id) && !excluded.has(id));
}

/** Neu hinzugekommene Freigaben (Schlüssel `typ:id`), z. B. nach `replaceShares` */
export function addedPrincipals<T extends Principal>(
	before: readonly Principal[],
	after: readonly T[]
): T[] {
	const old = new Set(before.map((p) => `${p.type}:${p.id}`));
	return after.filter((p) => !old.has(`${p.type}:${p.id}`));
}

/**
 * Principal-Schlüssel des Aufrufers (`typ:id`): immer `everyone:*` (bei angemeldeter Identität),
 * `user:<id>`, alle `role:<id>`, sowie `member:<id>`/`group:<id>` über verknüpfte Mitglieder.
 * Ohne `userId` (z. B. System) nur `everyone:*`.
 */
export async function principalKeysFor(ctx: RequestContext, moduleId: string): Promise<string[]> {
	const userId = ctx.userId;
	if (!userId) return [EVERYONE_KEY];
	// Je Request (= Kontextobjekt) nur einmal ermitteln – auch über Module hinweg, z. B. globale
	// Suche über events, galleries und files (#23, #68). Modulabhängig ist nur, ob `members`
	// für das aufrufende Modul erreichbar ist (Deklaration, aktiv). Kurze Lebensdauer als Schutz
	// für Kontexte, die länger als ein Request leben (Skripte, Tests).
	const memo = principalMemo(ctx);
	const keys = new Set<string>([EVERYONE_KEY, `user:${userId}`]);
	for (const id of await memoized(memo, 'roles', () => core.users.roleIds(userId))) {
		keys.add(`role:${id}`);
	}
	const members = await membersProvider(moduleId);
	if (members) {
		const { memberIds, groupIds } = await memoized(memo, 'principals', () =>
			members.principalIdsForUser(userId)
		);
		for (const id of memberIds) keys.add(`member:${id}`);
		for (const id of groupIds) keys.add(`group:${id}`);
	}
	return [...keys];
}

const PRINCIPAL_KEY_MEMO_MS = 5_000;
type PrincipalMemo = {
	roles?: { at: number; value: Promise<string[]> };
	principals?: { at: number; value: Promise<{ memberIds: string[]; groupIds: string[] }> };
};
const principalKeyMemo = new WeakMap<RequestContext, PrincipalMemo>();

function principalMemo(ctx: RequestContext): PrincipalMemo {
	let memo = principalKeyMemo.get(ctx);
	if (!memo) {
		memo = {};
		principalKeyMemo.set(ctx, memo);
	}
	return memo;
}

/** Wert je Kontext merken (auch laufende Abfragen teilen); Fehler werden nicht gemerkt */
function memoized<K extends keyof PrincipalMemo>(
	memo: PrincipalMemo,
	key: K,
	load: () => NonNullable<PrincipalMemo[K]>['value']
): NonNullable<PrincipalMemo[K]>['value'] {
	const hit = memo[key];
	if (hit && Date.now() - hit.at < PRINCIPAL_KEY_MEMO_MS) return hit.value;
	const value = load();
	const entry = { at: Date.now(), value } as NonNullable<PrincipalMemo[K]>;
	memo[key] = entry;
	value.catch(() => {
		if (memo[key] === entry) delete memo[key];
	});
	return value;
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
		const label = opts.everyoneLabel?.trim() || (await defaultEveryoneLabel());
		const hit = [label, t('sharing.everyone'), 'alle', 'everyone'].some((s) =>
			s.toLocaleLowerCase('de').includes(needle)
		);
		if (hit) byType.everyone.push({ type: 'everyone', id: EVERYONE_ID, name: label });
	}
	if (types.has('role')) {
		const roles = await core.roles.directory(ctx, { search: q, limit });
		byType.role = roles.slice(0, limit).map((r) => ({ type: 'role', id: r.id, name: r.name }));
	}
	if (types.has('user')) {
		const showEmail = core.permissions.has(ctx, USERS_VIEW);
		const users = await core.users.directory(ctx, { search: q, limit });
		byType.user = users.slice(0, limit).map((u) => ({
			type: 'user',
			id: u.id,
			name: u.name,
			detail: showEmail ? u.email || null : null,
			image: u.image
		}));
	}
	const memberSearch = types.has('member') && canSeeMembers(ctx);
	if (types.has('group') || memberSearch) {
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
						image: g.image
					}));
			}
			if (memberSearch) {
				byType.member = (await members.searchMemberPrincipals(ctx, { search: q, limit }))
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

/**
 * Gebündelte Auflösung: Schlüssel `typ:id` → Anzeigedaten (nur gefundene, nur erlaubte Typen).
 * `purpose: 'display'`: Mitglieder ohne `members.member.view` als „Mitglied“ (ohne Name/Gruppen);
 * `'validate'`: reine Existenzprüfung (auch ohne das Recht; es werden keine Daten ausgegeben).
 */
async function resolvePrincipals(
	ctx: RequestContext,
	moduleId: string,
	list: readonly Principal[],
	opts: {
		types?: readonly PrincipalType[];
		everyoneLabel?: string;
		purpose: 'display' | 'validate';
	}
): Promise<Map<string, Display>> {
	const types = allowedTypes(opts.types);
	const found = new Map<string, Display>();
	const ids = (type: PrincipalType) => (types.has(type) ? uniqueIds(list, type) : []);

	if (types.has('everyone') && list.some((p) => p.type === 'everyone' && p.id === EVERYONE_ID)) {
		found.set(EVERYONE_KEY, {
			name: opts.everyoneLabel?.trim() || (await defaultEveryoneLabel())
		});
	}
	const showEmail = core.permissions.has(ctx, USERS_VIEW);
	for (const chunk of chunks(ids('user'), DIRECTORY_CHUNK)) {
		const users = await core.users.directory(ctx, { ids: chunk, limit: DIRECTORY_CHUNK });
		for (const u of users) {
			found.set(`user:${u.id}`, {
				name: u.name,
				detail: showEmail ? u.email || null : null,
				image: u.image
			});
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
					found.set(`group:${g.id}`, { name: g.name, color: g.color, image: g.image });
				}
			}
			const memberDetails = canSeeMembers(ctx);
			if (opts.purpose === 'display' && !memberDetails) {
				for (const id of memberIds) found.set(`member:${id}`, hiddenMember());
			} else {
				// Prüfung: nur Existenz (UUIDs, nichts wird ausgegeben) – daher im System-Kontext,
				// damit Speichern vorbereiteter Mitglieds-Freigaben nicht am Leserecht scheitert
				const lookupCtx = memberDetails ? ctx : core.auth.systemContext(moduleId);
				for (const chunk of chunks(memberIds, DIRECTORY_CHUNK)) {
					const rows = await members.searchMemberPrincipals(lookupCtx, {
						ids: chunk,
						limit: chunk.length
					});
					for (const m of rows) {
						found.set(`member:${m.id}`, {
							name: m.name,
							detail: m.groups.map((g) => g.name).join(', ') || null
						});
					}
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
	const found = await resolvePrincipals(ctx, moduleId, list, { ...opts, purpose: 'display' });
	return list.map((p) => ({
		type: p.type,
		id: p.id,
		...(found.get(principalKey(p)) ?? { name: t('sharing.unknown') })
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
	const found = await resolvePrincipals(ctx, moduleId, check, {
		types: opts.types,
		purpose: 'validate'
	});
	const issues: { path: (string | number)[]; message: string }[] = [];
	list.forEach((p, index) => {
		if (!keep.has(principalKey(p)) && !found.has(principalKey(p))) {
			issues.push({
				path: [opts.pathPrefix ?? 'shares', index, 'id'],
				message: t('sharing.invalidPrincipal')
			});
		}
	});
	if (issues.length) throw errors.validation(issues);
}

/**
 * Eigenes Rate-Limit für Freigabe-Suchen (`GET /principals`, Benutzersuchen zum Teilen): das UI
 * fragt höchstens alle 250 ms, systematisches Abziehen des Verzeichnisses wird gebremst.
 */
export const PRINCIPAL_SEARCH_RATE_LIMIT = { limit: 60, windowSec: 60 } as const;

/**
 * Die Freigabe-Suche steht nur Personen offen, die im Modul tatsächlich etwas teilen dürfen:
 * System, eines der Rechte `anyPermission` (z. B. `<modul>.<obj>.create`/`edit-all`) oder – über die
 * SQL-Bedingung `canShareSql` (Unterabfrage im Modulschema, z. B. „besitzt ein Objekt oder hat eine
 * `edit`-Freigabe“) – mindestens ein teilbares Objekt. Sonst `403`.
 * Ruft Core und das Modulschema auf: nie innerhalb einer offenen Modul-Transaktion.
 */
export async function requireShareCapability(
	ctx: RequestContext,
	moduleId: string,
	opts: {
		anyPermission?: readonly string[];
		canShareSql?: (userId: string, keys: readonly string[]) => SQL;
	}
): Promise<void> {
	if (ctx.actor.type === 'system') return;
	if (opts.anyPermission?.some((p) => core.permissions.has(ctx, p))) return;
	const userId = ctx.userId;
	if (userId && opts.canShareSql) {
		const keys = await principalKeysFor(ctx, moduleId);
		const condition = opts.canShareSql(userId, keys);
		const ok = await core.database.forModule(moduleId).transaction(async (tx) => {
			const res = (await tx.execute(sql`SELECT EXISTS (${condition}) AS ok`)) as unknown as {
				rows: { ok: unknown }[];
			};
			const v = res.rows[0]?.ok;
			return v === true || v === 't';
		});
		if (ok) return;
	}
	throw errors.forbidden(t('sharing.searchForbidden'));
}
