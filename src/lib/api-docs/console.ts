/**
 * Ausprobieren-Konsole der API-Übersicht: reine, client-taugliche Hilfsfunktionen zum Bauen
 * der Anfrage (same-origin, Session-Cookie), zum Erzeugen eines curl-Beispiels und zum
 * Aufbereiten der Antwort. Keine Server-Imports.
 */
import { t } from '$lib/i18n';
import type { ApiMethod, ConsoleRequestBuild, ConsoleRequestInput, ConsoleResult } from './types';

/** Höchstlänge des angezeigten Antwort-Bodys (Zeichen) */
export const MAX_RESULT_CHARS = 200_000;

const API_PREFIX = '/api/v1/';
const BODY_METHODS: ReadonlySet<ApiMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/** Namen der `:name`-Platzhalter in Reihenfolge (ohne Duplikate) */
export function pathParamNames(path: string): string[] {
	const names: string[] = [];
	for (const match of path.matchAll(PARAM_RE)) {
		const name = match[1]!;
		if (!names.includes(name)) names.push(name);
	}
	return names;
}

/** Ändernde Methode (alles außer GET) */
export function isMutating(method: string): boolean {
	return method.toUpperCase() !== 'GET';
}

/** Schutz: nur relative Pfade unter `/api/v1/`, keine Traversal-/Protokoll-Tricks */
function isSafeApiPath(path: string): boolean {
	if (!path.startsWith(API_PREFIX)) return false;
	if (path.includes('//') || path.includes('\\')) return false;
	if (/[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;
	if (/[\s?#]/.test(path)) return false;
	const segments = path.split('/');
	if (segments.some((s) => s === '.' || s === '..' || s.includes('..'))) return false;
	return true;
}

function fail(error: string, field?: string): ConsoleRequestBuild {
	return field ? { ok: false, error, field } : { ok: false, error };
}

/** Baut die Anfrage für `fetch(url, init)` (same-origin, ohne Authorization-Header) */
export function buildConsoleRequest(input: ConsoleRequestInput): ConsoleRequestBuild {
	if (!isSafeApiPath(input.path)) {
		return fail(t('api-docs.console.invalidPath'), 'path');
	}

	let pathname = input.path;
	for (const name of pathParamNames(input.path)) {
		const raw = input.params[name];
		const value = typeof raw === 'string' ? raw.trim() : '';
		if (!value) return fail(t('api-docs.console.paramMissing', { name }), `param:${name}`);
		if (value === '.' || value === '..') {
			return fail(t('api-docs.console.paramInvalid', { name }), `param:${name}`);
		}
		const encoded = encodeURIComponent(value);
		pathname = pathname.replace(new RegExp(`:${name}(?![A-Za-z0-9_])`, 'g'), () => encoded);
	}

	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(input.query)) {
		if (!key || value === undefined || value === null) continue;
		const text = String(value);
		if (text.trim() === '') continue;
		search.append(key, text);
	}
	const qs = search.toString();
	const url = qs ? `${pathname}?${qs}` : pathname;

	const headers: Record<string, string> = { accept: 'application/json' };
	const init: { method: ApiMethod; headers: Record<string, string>; body?: string } = {
		method: input.method,
		headers
	};

	if (BODY_METHODS.has(input.method) && input.bodyText.trim() !== '') {
		let parsed: unknown;
		try {
			parsed = JSON.parse(input.bodyText);
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			return fail(t('api-docs.console.bodyInvalid', { detail }), 'body');
		}
		init.body = JSON.stringify(parsed);
		headers['content-type'] = 'application/json';
	}

	return { ok: true, url, init };
}

/** Text für die Shell in einfache Anführungszeichen setzen (' → '\'') */
function shellQuote(text: string): string {
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

/**
 * curl-Beispiel mit API-Key-Platzhalter `$EPK_KEY` (nie echte Cookies).
 * `multiline` = Zeilen mit `\` umbrechen. Ungültige Eingabe → ''.
 */
export function buildCurl(
	input: ConsoleRequestInput,
	origin: string,
	options: { multiline?: boolean } = {}
): string {
	const built = buildConsoleRequest(input);
	if (!built.ok) return '';
	const base = origin.trim().replace(/\/+$/, '');
	const parts: string[] = [`curl -X ${built.init.method} ${shellQuote(base + built.url)}`];
	parts.push(`-H "Accept: application/json"`);
	parts.push(`-H "Authorization: Bearer $EPK_KEY"`);
	if (built.init.body !== undefined) {
		parts.push(`-H "Content-Type: application/json"`);
		parts.push(`--data ${shellQuote(built.init.body)}`);
	}
	return parts.join(options.multiline === false ? ' ' : ' \\\n  ');
}

function truncate(text: string): string {
	if (text.length <= MAX_RESULT_CHARS) return text;
	return `${text.slice(0, MAX_RESULT_CHARS)}\n${t('api-docs.console.truncated')}`;
}

function isJsonType(type: string): boolean {
	return /[/+]json\b/.test(type);
}

function isTextType(type: string): boolean {
	return (
		type.startsWith('text/') ||
		type.includes('xml') ||
		type.includes('javascript') ||
		type.includes('x-www-form-urlencoded')
	);
}

/** Antwort für die Anzeige aufbereiten */
export async function readConsoleResult(
	res: Response,
	startedAt: number,
	now = Date.now()
): Promise<ConsoleResult> {
	const contentType = res.headers.get('content-type');
	const type = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
	let bodyText: string;

	if (type && !isJsonType(type) && !isTextType(type)) {
		const bytes = (await res.arrayBuffer()).byteLength;
		bodyText = t('api-docs.console.binary', { type, bytes });
	} else {
		const raw = await res.text();
		if (isJsonType(type) && raw.trim() !== '') {
			try {
				bodyText = JSON.stringify(JSON.parse(raw), null, 2);
			} catch {
				bodyText = raw;
			}
		} else {
			bodyText = raw;
		}
		bodyText = truncate(bodyText);
	}

	return {
		status: res.status,
		durationMs: Math.max(0, Math.round(now - startedAt)),
		requestId: res.headers.get('x-request-id'),
		rateLimitRemaining: res.headers.get('x-ratelimit-remaining'),
		contentType,
		bodyText
	};
}
