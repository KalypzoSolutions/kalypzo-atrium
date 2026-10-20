/**
 * Globale Suche: sammelt Treffer aus Core-Bereichen (Benutzer*innen, Rollen) und den Suchquellen
 * aktiver Module (`ModuleDefinition.search`). Jede Quelle nur mit Recht; Module filtern selbst
 * objektbezogen. Quellen laufen nacheinander (PGlite hat nur eine Sitzung), Fehler einer Quelle
 * überspringen nur diese.
 */
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
import { getDb, schema } from '../database/client';
import { allDefinitions } from '../modules/registry';
import { enabledModuleIds } from '../modules/state';
import type { ModuleSearchProvider } from '../modules/types';

/** `%`, `_` und `\` in LIKE-Mustern wörtlich nehmen */
export function likePattern(q: string): string {
	return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Nur relative App-Pfade zulassen (kein `//host`, kein `javascript:`). */
export function isSafeHref(href: unknown): href is string {
	return (
		typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') && !/\s/.test(href)
	);
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
		subtitle: u.active ? u.email : `${u.email} · deaktiviert`,
		href: `/admin/users?q=${encodeURIComponent(u.email)}`,
		icon: 'users',
		type: 'Benutzer*in'
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
		type: 'Rolle'
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
		groups.push({ source: 'core', label: 'Verwaltung', hits: clean(core, limit * 2) });

	const enabled = await enabledModuleIds();
	for (const def of allDefinitions()) {
		const provider = def.search;
		const id = def.manifest.id;
		if (!provider || !enabled.has(id) || !allowed(ctx, provider)) continue;
		try {
			const hits = clean(await provider.run(ctx, query, limit), limit);
			if (hits.length) groups.push({ source: id, label: def.manifest.name, hits });
		} catch (e) {
			console.error(`[search] Quelle ${id} fehlgeschlagen:`, e);
		}
	}
	return { query, groups };
}
