/**
 * Filter, Gruppierung und Kennzahlen der API-Übersicht (`/api-docs`). Rein, client-tauglich.
 */
import type {
	ApiAccess,
	ApiCatalog,
	ApiCatalogEntry,
	ApiCatalogFilter,
	ApiCatalogGroup,
	ApiMethod
} from './types';

export const API_METHODS: readonly ApiMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

type AccessFilter = ApiAccess | 'session';
const ACCESS_VALUES: readonly AccessFilter[] = ['public', 'authenticated', 'permission', 'session'];

export const METHOD_OPTIONS: { value: ApiMethod; label: string }[] = API_METHODS.map((m) => ({
	value: m,
	label: m
}));

export const ACCESS_OPTIONS: { value: AccessFilter; label: string }[] = [
	{ value: 'public', label: 'Öffentlich' },
	{ value: 'authenticated', label: 'Nur Anmeldung' },
	{ value: 'permission', label: 'Mit Berechtigung' },
	{ value: 'session', label: 'Nur Session' }
];

function isMethod(v: unknown): v is ApiMethod {
	return typeof v === 'string' && (API_METHODS as readonly string[]).includes(v);
}

function isAccess(v: unknown): v is AccessFilter {
	return typeof v === 'string' && (ACCESS_VALUES as readonly string[]).includes(v);
}

function searchTokens(search: string | undefined): string[] {
	return (search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(e: ApiCatalogEntry): string {
	return [e.path, e.summary, e.description ?? '', e.permission ?? '', e.moduleName, e.method]
		.join('\n')
		.toLowerCase();
}

export function filterEntries(entries: ApiCatalogEntry[], f: ApiCatalogFilter): ApiCatalogEntry[] {
	const tokens = searchTokens(f.search);
	return entries.filter((e) => {
		if (f.moduleId && e.moduleId !== f.moduleId) return false;
		if (f.method && e.method !== f.method) return false;
		if (f.access) {
			if (f.access === 'session' ? !e.sessionOnly : e.access !== f.access) return false;
		}
		if (f.onlyAllowed && !e.allowed) return false;
		if (tokens.length) {
			const text = haystack(e);
			if (!tokens.every((t) => text.includes(t))) return false;
		}
		return true;
	});
}

function compareEntries(a: ApiCatalogEntry, b: ApiCatalogEntry): number {
	if (a.path !== b.path) return a.path < b.path ? -1 : 1;
	return API_METHODS.indexOf(a.method) - API_METHODS.indexOf(b.method);
}

export function groupEntries(
	catalog: ApiCatalog,
	entries: ApiCatalogEntry[]
): { group: ApiCatalogGroup; entries: ApiCatalogEntry[] }[] {
	const byGroup = new Map<string, ApiCatalogEntry[]>();
	for (const e of entries) {
		const list = byGroup.get(e.group);
		if (list) list.push(e);
		else byGroup.set(e.group, [e]);
	}
	const result: { group: ApiCatalogGroup; entries: ApiCatalogEntry[] }[] = [];
	for (const group of catalog.groups) {
		const list = byGroup.get(group.id);
		if (list?.length) result.push({ group, entries: [...list].sort(compareEntries) });
	}
	return result;
}

export function moduleOptions(catalog: ApiCatalog): { value: string; label: string }[] {
	const options: { value: string; label: string }[] = [];
	const seen = new Set<string>();
	const add = (value: string, label: string) => {
		if (seen.has(value)) return;
		seen.add(value);
		options.push({ value, label });
	};
	const core = catalog.entries.find((e) => e.moduleId === 'core');
	if (core) add('core', core.moduleName || 'Core');
	for (const group of catalog.groups) {
		for (const e of catalog.entries) {
			if (e.group === group.id && e.moduleId !== 'core') add(e.moduleId, e.moduleName);
		}
		if (group.id.startsWith('module:')) add(group.id.slice('module:'.length), group.label);
	}
	return options;
}

export interface ApiCatalogStats {
	total: number;
	byMethod: Record<ApiMethod, number>;
	publicCount: number;
	allowedCount: number;
}

export function catalogStats(entries: ApiCatalogEntry[]): ApiCatalogStats {
	const byMethod: Record<ApiMethod, number> = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 };
	let publicCount = 0;
	let allowedCount = 0;
	for (const e of entries) {
		byMethod[e.method]++;
		if (e.access === 'public') publicCount++;
		if (e.allowed) allowedCount++;
	}
	return { total: entries.length, byMethod, publicCount, allowedCount };
}

const MODULE_ID_RE = /^[a-z0-9-]{1,64}$/;

export function filterFromSearchParams(sp: URLSearchParams): ApiCatalogFilter {
	const f: ApiCatalogFilter = {};
	const q = sp.get('q')?.trim();
	if (q) f.search = q.slice(0, 200);
	const moduleId = sp.get('module');
	if (moduleId && MODULE_ID_RE.test(moduleId)) f.moduleId = moduleId;
	const method = sp.get('method')?.toUpperCase();
	if (isMethod(method)) f.method = method;
	const access = sp.get('access');
	if (isAccess(access)) f.access = access;
	if (sp.get('allowed') === '1') f.onlyAllowed = true;
	return f;
}

export function filterToSearchParams(f: ApiCatalogFilter): URLSearchParams {
	const sp = new URLSearchParams();
	const q = f.search?.trim();
	if (q) sp.set('q', q);
	if (f.moduleId && MODULE_ID_RE.test(f.moduleId)) sp.set('module', f.moduleId);
	if (isMethod(f.method)) sp.set('method', f.method);
	if (isAccess(f.access)) sp.set('access', f.access);
	if (f.onlyAllowed) sp.set('allowed', '1');
	return sp;
}
