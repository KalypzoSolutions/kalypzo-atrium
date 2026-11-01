/**
 * Einbetten von Modul-Inhalten (z. B. Whiteboard in einer Notiz): sammelt die Anbieter aktiver Module
 * (`ModuleDefinition.embeds`), nur mit Recht. Anbieter filtern selbst objektbezogen. Wie die globale Suche
 * laufen die Quellen bei PGlite nacheinander, mit echtem Pool parallel mit Zeitbudget; Fehler einer Quelle
 * überspringen nur diese. Vertrag (Client + Server): `$lib/sdk/types/embeds.ts`.
 */
import { t } from '$lib/i18n';
import type { RequestContext } from '$lib/sdk/types';
import type { EmbedHit, EmbedInfo, EmbedKind, EmbedRef } from '$lib/sdk/types/embeds';
import { databaseAllowsParallelQueries } from '../database/client';
import { allDefinitions } from '../modules/registry';
import { enabledModuleIds } from '../modules/state';
import type { ModuleDefinition, ModuleEmbedProvider } from '../modules/types';
import { normalizeQuery } from '../search/service';

/** Treffer je Art */
export const EMBED_LIMIT_PER_KIND = 10;
/** Höchstzahl Verweise je `describe` */
export const EMBED_DESCRIBE_MAX = 200;
/** Zeitbudget je Quelle bei paralleler Abfrage */
export const EMBED_SOURCE_BUDGET_MS = 3000;

const KEY_RE = /^[a-z][a-z0-9-]{0,40}$/;
const REF_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Pfad relativ zur Embed-Route: Segmente ohne `.`-Tricks, kein `//`, keine Query */
const PATH_RE = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

interface Source {
	module: string;
	provider: ModuleEmbedProvider;
}

function allowedFor(ctx: RequestContext, p: ModuleEmbedProvider): boolean {
	return !p.permission || ctx.permissions.has(p.permission);
}

/** Anbieter aktiver Module, die die Person nutzen darf */
async function sources(ctx: RequestContext): Promise<Source[]> {
	const enabled = await enabledModuleIds();
	const out: Source[] = [];
	for (const def of allDefinitions() as ModuleDefinition[]) {
		if (!def.embeds?.length || !enabled.has(def.manifest.id)) continue;
		for (const provider of def.embeds) {
			if (allowedFor(ctx, provider)) out.push({ module: def.manifest.id, provider });
		}
	}
	return out;
}

/** Läuft je Quelle nacheinander (PGlite) bzw. parallel mit Zeitbudget; Fehler → `fallback` */
async function runAll<T>(
	list: readonly Source[],
	label: string,
	fallback: T,
	run: (s: Source) => Promise<T>
): Promise<T[]> {
	const safe = async (s: Source): Promise<T> => {
		try {
			return await run(s);
		} catch (e) {
			console.error(`[embeds] ${label} ${s.module}/${s.provider.kind} fehlgeschlagen:`, e);
			return fallback;
		}
	};
	if (!databaseAllowsParallelQueries()) {
		const results: T[] = [];
		for (const s of list) results.push(await safe(s));
		return results;
	}
	return Promise.all(
		list.map((s) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const budget = new Promise<T>((resolve) => {
				timer = setTimeout(() => {
					console.error(
						`[embeds] ${label} ${s.module}/${s.provider.kind} hat das Zeitbudget überschritten`
					);
					resolve(fallback);
				}, EMBED_SOURCE_BUDGET_MS);
			});
			return Promise.race([safe(s), budget]).finally(() => clearTimeout(timer));
		})
	);
}

/** Arten für die Auswahl „Einbetten“ */
export async function listEmbedKinds(ctx: RequestContext): Promise<EmbedKind[]> {
	if (!ctx.userId && ctx.actor.type !== 'system') return [];
	return (await sources(ctx)).map((s) => ({
		module: s.module,
		kind: s.provider.kind,
		label: s.provider.label,
		icon: s.provider.icon
	}));
}

/** Suche über alle Arten (ab 2 Zeichen, je Art ≤ 10 Treffer) */
export async function searchEmbeds(
	ctx: RequestContext,
	rawQuery: string | null | undefined
): Promise<EmbedHit[]> {
	const query = normalizeQuery(rawQuery);
	if (!query || (!ctx.userId && ctx.actor.type !== 'system')) return [];
	const list = await sources(ctx);
	const groups = await runAll(list, 'search', [] as EmbedHit[], async (s) => {
		const hits = await s.provider.search(ctx, query, EMBED_LIMIT_PER_KIND);
		const seen = new Set<string>();
		const out: EmbedHit[] = [];
		for (const h of hits) {
			const refId = String(h?.refId ?? '');
			if (!REF_ID_RE.test(refId) || !h.title || seen.has(refId)) continue;
			seen.add(refId);
			out.push({
				module: s.module,
				kind: s.provider.kind,
				refId,
				title: String(h.title).slice(0, 200),
				subtitle: h.subtitle ? String(h.subtitle).slice(0, 200) : null,
				icon: s.provider.icon,
				kindLabel: s.provider.label
			});
			if (out.length >= EMBED_LIMIT_PER_KIND) break;
		}
		return out;
	});
	return groups.flat();
}

function unavailable(ref: EmbedRef, provider?: ModuleEmbedProvider): EmbedInfo {
	return {
		module: ref.module,
		kind: ref.kind,
		refId: ref.refId,
		available: false,
		title: t('embeds.unavailable'),
		icon: provider?.icon ?? 'box',
		kindLabel: provider?.label ?? t('embeds.embeddedContent'),
		embedPath: null,
		openHref: null,
		canEdit: false
	};
}

/**
 * Verweise je Betrachter*in auflösen, gleiche Reihenfolge wie `refs` (höchstens 200). Unbekannte Art, Modul aus,
 * fehlendes Recht oder kein Zugriff → `available: false`, Titel „Nicht verfügbar“. Nie in einer offenen
 * Modul-Transaktion aufrufen.
 */
export async function describeEmbeds(
	ctx: RequestContext,
	refs: readonly EmbedRef[]
): Promise<EmbedInfo[]> {
	const items = refs.slice(0, EMBED_DESCRIBE_MAX);
	if (!items.length) return [];
	const list = await sources(ctx);
	const byKey = new Map(list.map((s) => [`${s.module}:${s.provider.kind}`, s]));
	const wanted = new Map<string, Set<string>>();
	for (const r of items) {
		if (!KEY_RE.test(r.module) || !KEY_RE.test(r.kind) || !REF_ID_RE.test(r.refId)) continue;
		const key = `${r.module}:${r.kind}`;
		if (!byKey.has(key)) continue;
		const ids = wanted.get(key) ?? new Set<string>();
		ids.add(r.refId);
		wanted.set(key, ids);
	}
	const active = [...wanted.keys()].map((k) => byKey.get(k)!);
	const empty = new Map<string, { title: string; canEdit: boolean; path: string }>();
	const results = await runAll(active, 'describe', empty, (s) =>
		s.provider.describe(ctx, [...wanted.get(`${s.module}:${s.provider.kind}`)!])
	);
	const found = new Map<string, Map<string, { title: string; canEdit: boolean; path: string }>>();
	active.forEach((s, i) => found.set(`${s.module}:${s.provider.kind}`, results[i] ?? empty));

	return items.map((r) => {
		const key = `${r.module}:${r.kind}`;
		const source = byKey.get(key);
		const hit = found.get(key)?.get(r.refId);
		if (!source || !hit || !PATH_RE.test(String(hit.path ?? '')) || !hit.title) {
			return unavailable(r, source?.provider);
		}
		return {
			module: r.module,
			kind: r.kind,
			refId: r.refId,
			available: true,
			title: String(hit.title).slice(0, 200),
			icon: source.provider.icon,
			kindLabel: source.provider.label,
			embedPath: `/embed/${r.module}/${hit.path}`,
			openHref: `/modules/${r.module}/${hit.path}`,
			canEdit: hit.canEdit === true
		};
	});
}
