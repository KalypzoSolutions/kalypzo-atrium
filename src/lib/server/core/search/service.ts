/**
 * Globale Suche: sammelt Treffer aus Core-Bereichen (Benutzer*innen, Rollen) und den Suchquellen
 * aktiver Module (`ModuleDefinition.search`). Jede Quelle nur mit Recht; Module filtern selbst
 * objektbezogen. Quellen laufen nacheinander (PGlite hat nur eine Sitzung), Fehler einer Quelle
 * überspringen nur diese.
 */
import { localized, t } from '$lib/i18n';
import { asc, ilike, or } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import {
	SEARCH_LIMIT_PER_SOURCE,
	SEARCH_MAX_LENGTH,
	SEARCH_MIN_LENGTH,
	type SearchGroup,
	type SearchHit,
	type SearchResponse
} from '$lib/sdk/types/search';
import { databaseAllowsParallelQueries, getDb, schema } from '../database/client';
import { allDefinitions } from '../modules/registry';
import { enabledModuleIds } from '../modules/state';
import type { ModuleSearchProvider } from '../modules/types';
import { isSafeRelativeHref } from '../safe-redirect';

/** `%`, `_` und `\` in LIKE-Mustern wörtlich nehmen */
export function likePattern(q: string): string {
	return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Nur relative App-Pfade zulassen (kein `//host`, kein `javascript:`). */
export function isSafeHref(href: unknown): href is string {
	return typeof href === 'string' && isSafeRelativeHref(href);
}

export function normalizeQuery(raw: string | null | undefined): string | null {
	const q = (raw ?? '').trim().replace(/\s+/g, ' ');
	if (q.length < SEARCH_MIN_LENGTH) return null;
	return q.slice(0, SEARCH_MAX_LENGTH);
}

export function allowed(
	ctx: RequestContext,
	p: Pick<ModuleSearchProvider, 'permission' | 'anyPermission'>
): boolean {
	if (p.permission && !ctx.permissions.has(p.permission)) return false;
	if (p.anyPermission?.length && !p.anyPermission.some((x) => ctx.permissions.has(x))) return false;
	return true;
}

function clean(hits: SearchHit[], limit: number): SearchHit[] {
	const seen = new Set<string>();
	const out: SearchHit[] = [];
	for (const h of hits) {
		if (!h || !isSafeHref(h.href) || !h.title || seen.has(h.id)) continue;
		seen.add(h.id);
		out.push({
			id: String(h.id),
			title: String(h.title).slice(0, 200),
			subtitle: h.subtitle ? String(h.subtitle).slice(0, 200) : undefined,
			href: h.href,
			icon: h.icon,
			type: String(h.type).slice(0, 40)
		});
		if (out.length >= limit) break;
	}
	return out;
}

async function searchUsers(q: string, limit: number): Promise<SearchHit[]> {
	const p = likePattern(q);
	const rows = await getDb()
		.select({
			id: schema.user.id,
			name: schema.user.name,
			email: schema.user.email,
			active: schema.user.active
		})
		.from(schema.user)
		.where(or(ilike(schema.user.name, p), ilike(schema.user.email, p)))
		.orderBy(asc(schema.user.name))
		.limit(limit);
	return rows.map((u) => ({
		id: u.id,
		title: u.name,
		subtitle: u.active ? u.email : `${u.email} · ${t('search.deactivated')}`,
		href: `/admin/users?q=${encodeURIComponent(u.email)}`,
		icon: 'users',
		type: t('search.typeUser')
	}));
}

async function searchRoles(q: string, limit: number): Promise<SearchHit[]> {
	const rows = await getDb()
		.select({ id: schema.role.id, name: schema.role.name, description: schema.role.description })
		.from(schema.role)
		.where(ilike(schema.role.name, likePattern(q)))
		.orderBy(asc(schema.role.name))
		.limit(limit);
	return rows.map((r) => ({
		id: r.id,
		title: r.name,
		subtitle: r.description ?? undefined,
		href: '/admin/roles',
		icon: 'shield',
		type: t('search.typeRole')
	}));
}

export async function searchEverything(
	ctx: RequestContext,
	rawQuery: string | null | undefined,
	opts: { limitPerSource?: number } = {}
): Promise<SearchResponse> {
	const query = normalizeQuery(rawQuery);
	if (!query || !ctx.userId) return { query: query ?? '', groups: [] };
	const limit = Math.min(Math.max(1, opts.limitPerSource ?? SEARCH_LIMIT_PER_SOURCE), 20);
	const groups: SearchGroup[] = [];

	const core: SearchHit[] = [];
	if (ctx.permissions.has('core.users.view')) core.push(...(await searchUsers(query, limit)));
	if (ctx.permissions.has('core.roles.view')) core.push(...(await searchRoles(query, limit)));
	if (core.length)
		groups.push({ source: 'core', label: t('search.coreGroup'), hits: clean(core, limit * 2) });

	const enabled = await enabledModuleIds();
	const sources = allDefinitions().filter(
		(def) => def.search && enabled.has(def.manifest.id) && allowed(ctx, def.search)
	);
	const runSource = async (def: (typeof sources)[number]): Promise<SearchGroup | null> => {
		const id = def.manifest.id;
		try {
			const hits = clean(await def.search!.run(ctx, query, limit), limit);
			return hits.length ? { source: id, label: localized(def.manifest.name), hits } : null;
		} catch (e) {
			console.error(`[search] Quelle ${id} fehlgeschlagen:`, e);
			return null;
		}
	};
	if (databaseAllowsParallelQueries()) {
		// Echter Pool: Quellen gleichzeitig, je Quelle ein Zeitbudget (#68); Reihenfolge bleibt.
		// Principal-Schlüssel teilen sich die Quellen über das Memo am Kontext (`principalKeysFor`).
		const results = await Promise.all(sources.map((def) => withBudget(runSource(def), def)));
		for (const g of results) if (g) groups.push(g);
	} else {
		// PGlite / eine Verbindung: strikt nacheinander
		for (const def of sources) {
			const g = await runSource(def);
			if (g) groups.push(g);
		}
	}
	return { query, groups };
}

/** Zeitbudget je Suchquelle bei paralleler Suche; danach wird die Quelle übersprungen */
export const SEARCH_SOURCE_BUDGET_MS = 3000;

function withBudget(
	run: Promise<SearchGroup | null>,
	def: { manifest: { id: string } }
): Promise<SearchGroup | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const budget = new Promise<null>((resolve) => {
		timer = setTimeout(() => {
			console.error(`[search] Quelle ${def.manifest.id} hat das Zeitbudget überschritten`);
			resolve(null);
		}, SEARCH_SOURCE_BUDGET_MS);
	});
	return Promise.race([run, budget]).finally(() => clearTimeout(timer));
}
