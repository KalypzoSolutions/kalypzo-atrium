/**
 * Modul-Marktplatz: öffentlicher Index der Kalypzo-Website (`core.modules.marketplaceUrl`, Standard
 * `https://atrium.kalypzo.de/marketplace/v1/index.json`, Schema 1).
 *
 * Grundsatz: Atrium funktioniert **voll ohne** erreichbare Website. Nichts hier wirft; Start, Modulverwaltung und
 * Installation hängen nicht am Marktplatz. Ablauf:
 * - Prozess-Cache + dauerhafte letzte gültige Fassung in `marketplace_cache` (Migration 0014, nie gesichert).
 * - `getMarketplace()` liefert sofort den Cache; ist er älter als 15 min, startet eine Aktualisierung im
 *   Hintergrund, auf die höchstens `waitMs` gewartet wird. Gleichzeitige Aufrufe teilen sich einen Abruf.
 * - `refreshMarketplace()` ruft wirklich ab (Job `core.marketplace-refresh`, Knopf „Jetzt aktualisieren“).
 * - Abruf ohne Nutzer- oder Instanzbezug (nur `user-agent`, `accept`, ggf. `If-None-Match`), 2,5 s Zeitlimit,
 *   ≤ 2 MB, Weiterleitungen nur auf https.
 * - Tolerantes Parsen: unbekannte Felder werden ignoriert, ungültige Einzel-Einträge übersprungen, nur https-Links;
 *   Installationslinks nur auf `https://github.com/` (Installation geht ohnehin nur über GitHub).
 * - Kein Netz in Tests/E2E: `ATRIUM_MARKETPLACE_OFFLINE=1` oder `NODE_ENV=test` ohne Test-Fetch.
 */
import { sql } from 'drizzle-orm';
import { t } from '$lib/i18n';
import { getDb } from '../../database/client';
import { rowsOf, toIsoOrNull } from '../../database/rows';
import { logError } from '../../db-errors';
import { DEFAULT_MARKETPLACE_URL } from '../../settings/catalog';
import { getSetting } from '../../settings/service';
import { MODULE_ID_PATTERN } from '../types';

// ---------------------------------------------------------------------------
// Typen (auch für die Oberfläche, nur `import type`)
// ---------------------------------------------------------------------------

/** Text in beiden Sprachen (fehlt eine, steht dort die andere) */
export interface MarketplaceText {
	de: string;
	en: string;
}

export const MARKETPLACE_CATEGORIES = [
	'core',
	'organisation',
	'communication',
	'finance',
	'files',
	'productivity',
	'integration',
	'other'
] as const;
export type MarketplaceCategory = (typeof MARKETPLACE_CATEGORIES)[number];

export interface MarketplaceModule {
	id: string;
	name: MarketplaceText;
	description: MarketplaceText;
	/** Installationslink (immer `https://github.com/…`) */
	source: string;
}

export interface MarketplaceSource {
	id: string;
	name: string;
	description: MarketplaceText;
	repository: string;
	/** Installationslink des ganzen Pakets (immer `https://github.com/…`) */
	source: string;
	ref: string | null;
	path: string | null;
	publisher: { name: string; url: string | null };
	official: boolean;
	categories: MarketplaceCategory[];
	tags: string[];
	license: string | null;
	homepage: string | null;
	modules: MarketplaceModule[];
	/** `YYYY-MM-DD` oder `null` */
	addedAt: string | null;
}

export interface MarketplaceIndex {
	schema: 1;
	generatedAt: string | null;
	site: string | null;
	marketplace: { de: string | null; en: string | null };
	sources: MarketplaceSource[];
}

export type MarketplaceStatus = 'ok' | 'stale' | 'unreachable' | 'disabled' | 'incompatible';

export interface MarketplaceState {
	status: MarketplaceStatus;
	/** Letzter erfolgreicher Abruf (auch 304) */
	fetchedAt: string | null;
	lastAttemptAt: string | null;
	/** Übersetzte Fehlermeldung des letzten Versuchs, sonst `null` */
	error: string | null;
	url: string;
	index: MarketplaceIndex | null;
}

// ---------------------------------------------------------------------------
// Grenzen
// ---------------------------------------------------------------------------

/** Nach dieser Zeit wird im Hintergrund neu abgerufen (wie der Cache der Website) */
export const MARKETPLACE_TTL_MS = 15 * 60_000;
/** Älter als das (ohne erfolgreichen Abruf dazwischen) gilt die Fassung als veraltet */
const STALE_AFTER_MS = 2 * 60 * 60_000;
/** Nach einem Fehlschlag frühestens dann automatisch erneut versuchen (Knopf/Job dürfen immer) */
const RETRY_AFTER_FAILURE_MS = 60_000;
const FETCH_TIMEOUT_MS = 2_500;
const DEFAULT_WAIT_MS = 2_500;
export const MARKETPLACE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_SOURCES = 500;
const MAX_MODULES = 200;
const MAX_TAGS = 20;

// ---------------------------------------------------------------------------
// Parser (rein, getestet in tests/unit/marketplace.test.ts)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Getrimmter Text ohne Steuerzeichen, `null` wenn leer oder zu lang */
function text(v: unknown, max: number): string | null {
	if (typeof v !== 'string') return null;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Steuerzeichen werden bewusst entfernt
	const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
	return s && s.length <= max ? s : null;
}

/** Nur `https://` ohne Zugangsdaten */
export function httpsUrl(v: unknown, max = 500): string | null {
	const s = text(v, max);
	if (!s) return null;
	try {
		const u = new URL(s);
		if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
		return u.toString();
	} catch {
		return null;
	}
}

/** Installationslink: `https://github.com/<owner>/<repo>[/…]` */
export function githubUrl(v: unknown): string | null {
	const s = httpsUrl(v);
	if (!s) return null;
	const u = new URL(s);
	if (u.hostname !== 'github.com' || u.port) return null;
	const parts = u.pathname.split('/').filter(Boolean);
	if (parts.length < 2 || !parts.every((p) => /^[A-Za-z0-9._-]+$/.test(p))) return null;
	return s;
}

function localizedText(v: unknown, max: number): MarketplaceText | null {
	if (typeof v === 'string') {
		const s = text(v, max);
		return s ? { de: s, en: s } : null;
	}
	if (!isObj(v)) return null;
	const de = text(v.de, max);
	const en = text(v.en, max);
	if (!de && !en) return null;
	return { de: de ?? en!, en: en ?? de! };
}

function category(v: unknown): MarketplaceCategory | null {
	if (typeof v !== 'string') return null;
	return (MARKETPLACE_CATEGORIES as readonly string[]).includes(v)
		? (v as MarketplaceCategory)
		: 'other';
}

function parseModule(v: unknown): MarketplaceModule | null {
	if (!isObj(v)) return null;
	const id = typeof v.id === 'string' && MODULE_ID_PATTERN.test(v.id) ? v.id : null;
	const name = localizedText(v.name, 120);
	const source = githubUrl(v.source);
	if (!id || !name || !source) return null;
	return {
		id,
		name,
		description: localizedText(v.description, 1000) ?? { de: '', en: '' },
		source
	};
}

function parseSource(v: unknown): MarketplaceSource | null {
	if (!isObj(v)) return null;
	const id = text(v.id, 100);
	const name = text(v.name, 200);
	const repository = httpsUrl(v.repository);
	const source = githubUrl(v.source);
	const publisherName = isObj(v.publisher) ? text(v.publisher.name, 200) : null;
	if (!id || !/^[A-Za-z0-9._-]+$/.test(id) || !name || !repository || !source || !publisherName) {
		return null;
	}
	const categories = [
		...new Set((Array.isArray(v.categories) ? v.categories : []).map(category).filter((c) => c))
	] as MarketplaceCategory[];
	const tags = [
		...new Set(
			(Array.isArray(v.tags) ? v.tags : []).map((x) => text(x, 40)).filter((x): x is string => !!x)
		)
	].slice(0, MAX_TAGS);
	const seen = new Set<string>();
	const modules: MarketplaceModule[] = [];
	for (const raw of (Array.isArray(v.modules) ? v.modules : []).slice(0, MAX_MODULES)) {
		const m = parseModule(raw);
		if (m && !seen.has(m.id)) {
			seen.add(m.id);
			modules.push(m);
		}
	}
	const ref = text(v.ref, 200);
	const path = text(v.path, 300);
	return {
		id,
		name,
		description: localizedText(v.description, 2000) ?? { de: '', en: '' },
		repository,
		source,
		ref: ref && /^[A-Za-z0-9._/-]+$/.test(ref) ? ref : null,
		path: path && /^[A-Za-z0-9._/-]+$/.test(path) && !path.split('/').includes('..') ? path : null,
		publisher: {
			name: publisherName,
			url: isObj(v.publisher) ? httpsUrl(v.publisher.url) : null
		},
		official: v.official === true,
		categories: categories.length ? categories : ['other'],
		tags,
		license: text(v.license, 100),
		homepage: httpsUrl(v.homepage),
		modules,
		addedAt:
			typeof v.addedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.addedAt) ? v.addedAt : null
	};
}

export type ParseResult =
	| { ok: true; index: MarketplaceIndex }
	| { ok: false; reason: 'incompatible' | 'invalid' };

/**
 * Index tolerant lesen: `schema` muss `1` sein (andere Zahl → `incompatible`), unbekannte Felder werden ignoriert,
 * ungültige Quellen/Module übersprungen, doppelte Quell-IDs nur einmal übernommen.
 */
export function parseMarketplaceIndex(raw: unknown): ParseResult {
	if (!isObj(raw)) return { ok: false, reason: 'invalid' };
	if (raw.schema !== 1) {
		return { ok: false, reason: typeof raw.schema === 'number' ? 'incompatible' : 'invalid' };
	}
	if (!Array.isArray(raw.sources)) return { ok: false, reason: 'invalid' };
	const sources: MarketplaceSource[] = [];
	const seen = new Set<string>();
	for (const entry of raw.sources.slice(0, MAX_SOURCES)) {
		const s = parseSource(entry);
		if (s && !seen.has(s.id)) {
			seen.add(s.id);
			sources.push(s);
		}
	}
	const generatedAt =
		typeof raw.generatedAt === 'string' && !Number.isNaN(Date.parse(raw.generatedAt))
			? new Date(raw.generatedAt).toISOString()
			: null;
	const mp = isObj(raw.marketplace) ? raw.marketplace : {};
	return {
		ok: true,
		index: {
			schema: 1,
			generatedAt,
			site: httpsUrl(raw.site),
			marketplace: { de: httpsUrl(mp.de), en: httpsUrl(mp.en) },
			sources
		}
	};
}

/** Link in den Installations-Assistenten: ganzes Paket oder (mit `moduleId`) ein Modul daraus vorausgewählt */
export function installLinkFor(source: string, moduleId?: string): string {
	const q = new URLSearchParams({ url: source });
	if (moduleId) q.set('select', moduleId);
	return `/admin/modules/install?${q.toString()}`;
}

/** Body lesen und dabei nach `max` Bytes abbrechen (auch ohne/mit falschem `content-length`) */
export async function readLimited(res: Response, max = MARKETPLACE_MAX_BYTES): Promise<string> {
	const declared = Number(res.headers.get('content-length') ?? '');
	if (Number.isFinite(declared) && declared > max) {
		await res.body?.cancel().catch(() => {});
		throw new MarketplaceError('tooLarge');
	}
	if (!res.body) return '';
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => {});
			throw new MarketplaceError('tooLarge');
		}
		chunks.push(value);
	}
	const all = new Uint8Array(size);
	let off = 0;
	for (const c of chunks) {
		all.set(c, off);
		off += c.byteLength;
	}
	return new TextDecoder().decode(all);
}

// ---------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------

/** Fehlercodes; Texte unter `marketplace.error.<code>` */
type ErrorCode =
	| 'offline'
	| 'unreachable'
	| 'timeout'
	| 'http'
	| 'redirect'
	| 'tooLarge'
	| 'invalid'
	| 'incompatible'
	| 'notModifiedWithoutCache';

class MarketplaceError extends Error {
	constructor(
		readonly code: ErrorCode,
		readonly status?: number
	) {
		super(code);
	}
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let testFetch: FetchLike | null = null;

/** Nur für Tests: Abrufe umleiten (`null` = wieder echtes `fetch` bzw. offline in Tests) */
export function setMarketplaceFetchForTests(fn: FetchLike | null): void {
	testFetch = fn;
}

function fetchImpl(): FetchLike | null {
	if (testFetch) return testFetch;
	if (process.env.ATRIUM_MARKETPLACE_OFFLINE === '1') return null;
	if (process.env.NODE_ENV === 'test') return null;
	return (url, init) => fetch(url, init);
}

interface Entry {
	url: string;
	index: MarketplaceIndex | null;
	etag: string | null;
	fetchedAt: Date | null;
	lastAttemptAt: Date | null;
	/** Code des letzten Fehlers (`incompatible` eingeschlossen), `null` = letzter Versuch erfolgreich */
	error: string | null;
	httpStatus?: number;
}

const cache = new Map<string, Entry>();
const loaded = new Map<string, Promise<void>>();
const inflight = new Map<string, Promise<MarketplaceState>>();

/** Nur für Tests: Prozess-Cache leeren (die Tabelle bleibt) */
export function resetMarketplaceCacheForTests(): void {
	cache.clear();
	loaded.clear();
	inflight.clear();
}

async function configuredUrl(): Promise<string> {
	try {
		const v = await getSetting<string>('core.modules.marketplaceUrl');
		return typeof v === 'string' ? v.trim() : DEFAULT_MARKETPLACE_URL;
	} catch (e) {
		logError('[marketplace] Einstellung nicht lesbar', e);
		return DEFAULT_MARKETPLACE_URL;
	}
}

function errorText(e: Entry): string | null {
	if (!e.error) return null;
	const key = `marketplace.error.${e.error}`;
	return e.error === 'http' ? t(key, { status: e.httpStatus ?? 0 }) : t(key);
}

function stateOf(e: Entry, now = Date.now()): MarketplaceState {
	let status: MarketplaceStatus;
	if (e.error === 'incompatible') status = 'incompatible';
	else if (!e.index) status = 'unreachable';
	else if (e.error || !e.fetchedAt || now - e.fetchedAt.getTime() > STALE_AFTER_MS)
		status = 'stale';
	else status = 'ok';
	return {
		status,
		fetchedAt: e.fetchedAt?.toISOString() ?? null,
		lastAttemptAt: e.lastAttemptAt?.toISOString() ?? null,
		error: errorText(e),
		url: e.url,
		index: e.index
	};
}

const disabledState = (): MarketplaceState => ({
	status: 'disabled',
	fetchedAt: null,
	lastAttemptAt: null,
	error: null,
	url: '',
	index: null
});

/** Gespeicherte Fassung einmal je URL und Prozess lesen (Fehler → leerer Cache, kein Wurf) */
function ensureLoaded(url: string): Promise<void> {
	let p = loaded.get(url);
	if (!p) {
		p = (async () => {
			const entry: Entry = {
				url,
				index: null,
				etag: null,
				fetchedAt: null,
				lastAttemptAt: null,
				error: null
			};
			try {
				const [row] = await rowsOf(
					getDb(),
					sql`SELECT data, etag, fetched_at, last_attempt_at, last_error FROM marketplace_cache WHERE url = ${url}`
				);
				if (row) {
					const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
					const parsed = parseMarketplaceIndex(data);
					if (parsed.ok) {
						entry.index = parsed.index;
						entry.etag = typeof row.etag === 'string' ? row.etag : null;
						const f = toIsoOrNull(row.fetched_at);
						entry.fetchedAt = f ? new Date(f) : null;
					}
					const a = toIsoOrNull(row.last_attempt_at);
					entry.lastAttemptAt = a ? new Date(a) : null;
					entry.error = typeof row.last_error === 'string' ? row.last_error : null;
				}
			} catch (e) {
				logError('[marketplace] Gespeicherte Fassung nicht lesbar', e);
			}
			if (!cache.has(url)) cache.set(url, entry);
		})();
		loaded.set(url, p);
	}
	return p;
}

async function persist(e: Entry, withData: boolean): Promise<void> {
	try {
		const attempt = e.lastAttemptAt?.toISOString() ?? null;
		if (withData && e.index && e.fetchedAt) {
			await getDb().execute(
				sql`INSERT INTO marketplace_cache (url, data, etag, fetched_at, last_attempt_at, last_error)
					VALUES (${e.url}, ${JSON.stringify(e.index)}::jsonb, ${e.etag}, ${e.fetchedAt.toISOString()}, ${attempt}, ${e.error})
					ON CONFLICT (url) DO UPDATE SET data = EXCLUDED.data, etag = EXCLUDED.etag,
						fetched_at = EXCLUDED.fetched_at, last_attempt_at = EXCLUDED.last_attempt_at,
						last_error = EXCLUDED.last_error`
			);
		} else {
			// Nur Versuch/Fehler vermerken; ohne gültige Fassung gibt es keine Zeile
			await getDb().execute(
				sql`UPDATE marketplace_cache SET last_attempt_at = ${attempt}, last_error = ${e.error}
					WHERE url = ${e.url}`
			);
		}
	} catch (err) {
		logError('[marketplace] Speichern fehlgeschlagen', err);
	}
}

/** GET mit eigener Weiterleitungsbehandlung (nur https), Zeitlimit und Größenlimit */
async function downloadResponse(
	doFetch: FetchLike,
	url: string,
	etag: string | null
): Promise<{ notModified: true } | { notModified: false; body: string; etag: string | null }> {
	let current = url;
	const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const headers: Record<string, string> = {
			accept: 'application/json',
			'user-agent': 'kalypzo-atrium'
		};
		if (etag) headers['if-none-match'] = etag;
		let res: Response;
		try {
			res = await doFetch(current, { headers, redirect: 'manual', signal });
		} catch (e) {
			const name = (e as { name?: string } | null)?.name;
			throw new MarketplaceError(
				name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable'
			);
		}
		if (res.status === 304) return { notModified: true };
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel().catch(() => {});
			const loc = res.headers.get('location');
			const next = loc ? httpsUrl(new URL(loc, current).toString(), 2000) : null;
			if (!next) throw new MarketplaceError('redirect');
			current = next;
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			throw new MarketplaceError('http', res.status);
		}
		let body: string;
		try {
			body = await readLimited(res);
		} catch (e) {
			if (e instanceof MarketplaceError) throw e;
			throw new MarketplaceError(signal.aborted ? 'timeout' : 'unreachable');
		}
		return { notModified: false, body, etag: res.headers.get('etag') };
	}
	throw new MarketplaceError('redirect');
}

async function download(
	doFetch: FetchLike,
	url: string,
	etag: string | null
): ReturnType<typeof downloadResponse> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			downloadResponse(doFetch, url, etag),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new MarketplaceError('timeout')), FETCH_TIMEOUT_MS);
			})
		]);
	} finally {
		clearTimeout(timer);
	}
}

async function doRefresh(url: string): Promise<MarketplaceState> {
	await ensureLoaded(url);
	const e = cache.get(url)!;
	const now = new Date();
	e.lastAttemptAt = now;
	const doFetch = fetchImpl();
	if (!doFetch) {
		e.error = 'offline';
		return stateOf(e);
	}
	try {
		const r = await download(doFetch, url, e.index ? e.etag : null);
		if (r.notModified) {
			if (!e.index) throw new MarketplaceError('notModifiedWithoutCache');
			e.fetchedAt = now;
			e.error = null;
			await persist(e, true);
			return stateOf(e);
		}
		let raw: unknown;
		try {
			raw = JSON.parse(r.body);
		} catch {
			throw new MarketplaceError('invalid');
		}
		const parsed = parseMarketplaceIndex(raw);
		if (!parsed.ok) throw new MarketplaceError(parsed.reason);
		e.index = parsed.index;
		e.etag = r.etag;
		e.fetchedAt = now;
		e.error = null;
		e.httpStatus = undefined;
		await persist(e, true);
	} catch (err) {
		if (err instanceof MarketplaceError) {
			e.error = err.code;
			e.httpStatus = err.status;
		} else {
			logError('[marketplace] Abruf fehlgeschlagen', err);
			e.error = 'unreachable';
		}
		await persist(e, false);
	}
	return stateOf(e);
}

/** Gemeinsamer laufender Abruf je URL */
function startRefresh(url: string): Promise<MarketplaceState> {
	let p = inflight.get(url);
	if (!p) {
		p = doRefresh(url)
			.catch((err: unknown): MarketplaceState => {
				// Sollte nie passieren (doRefresh fängt alles) – trotzdem nie werfen
				logError('[marketplace] Unerwarteter Fehler', err);
				const e = cache.get(url);
				return e
					? stateOf(e)
					: {
							...disabledState(),
							status: 'unreachable',
							url,
							error: t('marketplace.error.unreachable')
						};
			})
			.finally(() => inflight.delete(url));
		inflight.set(url, p);
	}
	return p;
}

/** Echter Abruf (Job, Knopf „Jetzt aktualisieren“). Wirft nie. */
export async function refreshMarketplace(): Promise<MarketplaceState> {
	const url = await configuredUrl();
	if (!url) return disabledState();
	return startRefresh(url);
}

/**
 * Aktueller Stand für die Oberfläche. Liefert den Cache; ist er älter als 15 min (oder `refresh`), wird im
 * Hintergrund neu abgerufen und höchstens `waitMs` (Standard 2,5 s) darauf gewartet. Wirft nie.
 */
export async function getMarketplace(
	opts: { refresh?: boolean; waitMs?: number } = {}
): Promise<MarketplaceState> {
	const url = await configuredUrl();
	if (!url) return disabledState();
	await ensureLoaded(url);
	const e = cache.get(url)!;
	const now = Date.now();
	const fresh = !!e.fetchedAt && now - e.fetchedAt.getTime() <= MARKETPLACE_TTL_MS && !e.error;
	const recentFailure =
		!!e.error && !!e.lastAttemptAt && now - e.lastAttemptAt.getTime() < RETRY_AFTER_FAILURE_MS;
	if (!opts.refresh && (fresh || recentFailure)) return stateOf(e);
	const running = startRefresh(url);
	const waitMs = Math.max(0, opts.waitMs ?? DEFAULT_WAIT_MS);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), waitMs);
	});
	try {
		return (await Promise.race([running, timeout])) ?? stateOf(e);
	} finally {
		clearTimeout(timer);
	}
}
