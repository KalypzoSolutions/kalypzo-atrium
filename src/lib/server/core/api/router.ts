import { ZodError } from 'zod';
import { getLocale, t } from '$lib/i18n';
import '$lib/zod-locale';
import type { ApiErrorBody, RequestContext } from '$lib/sdk/types';
import { anonymousContext, resolveApiKey, resolveSession } from '../auth/context';
import { getDb, schema } from '../database/client';
import { userLocale, withLocale } from '../i18n/locale';
import { env } from '../env';
import { isUniqueViolation, logError } from '../db-errors';
import { errors, isCoreError } from '../errors';
import { isModuleEnabled } from '../modules/service';
import { has } from '../permissions/service';
import { hit } from '../rate-limit';
import { newId } from '../util';
import { matchEndpoint } from './registry';
import { requestIdFrom } from './request-id';

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_LIMIT = { limit: 120, windowSec: 60 };
const ANON_LIMIT = { limit: 30, windowSec: 60 };
const API_PREFIX = '/api/v1';

export interface ApiRequestInput {
	request: Request;
	url: URL;
	ip: string | null;
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-store',
			...headers
		}
	});
}

function errorResponse(e: unknown, requestId: string): Response {
	if (e instanceof ZodError) {
		e = errors.validation(e.issues);
	}
	if (!isCoreError(e) && isUniqueViolation(e)) {
		// Nicht abgefangene Unique-Verletzung: kein Serverfehler, sondern ein Konflikt (#55)
		logError(`[api] ${requestId} unbehandelte Unique-Verletzung`, e, { requestId });
		e = errors.conflict(t('api.conflictExists'));
	}
	if (isCoreError(e)) {
		const body: ApiErrorBody = {
			error: { code: e.code, message: e.message, details: e.details, requestId }
		};
		return json(body, e.status);
	}
	// Nie `e.message` loggen: bei DB-Fehlern enthält sie alle SQL-Parameterwerte (#56)
	logError(`[api] ${requestId}`, e, { requestId });
	const body: ApiErrorBody = {
		error: { code: 'internal_error', message: t('api.internalError'), requestId }
	};
	return json(body, 500);
}

function sameOrigin(request: Request): boolean {
	const origin = request.headers.get('origin');
	if (origin) return origin === env().ORIGIN || origin === new URL(request.url).origin;
	const site = request.headers.get('sec-fetch-site');
	return site === 'same-origin' || site === 'none';
}

/**
 * Liest den Body gestreamt mit Byte-Zähler und bricht ab, sobald `maxBytes` überschritten ist
 * (auch ohne bzw. mit falschem `Content-Length`, z. B. `Transfer-Encoding: chunked`). So landet nie
 * mehr als `maxBytes` (+ ein Chunk) im Speicher (#25).
 */
export async function readLimitedBody(
	request: Request,
	maxBytes: number,
	tooLarge: () => Error
): Promise<Uint8Array> {
	if (!request.body) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			// Rest nicht mehr lesen; Fehler beim Abbrechen sind hier bedeutungslos
			await reader.cancel().catch(() => undefined);
			throw tooLarge();
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.byteLength;
	}
	return out;
}

async function readBody(request: Request): Promise<unknown> {
	const tooLarge = () => errors.tooLarge(t('api.tooLarge'));
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_BODY_BYTES) throw tooLarge();
	const bytes = await readLimitedBody(request, MAX_BODY_BYTES, tooLarge);
	const text = new TextDecoder().decode(bytes);
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw errors.badRequest(t('api.invalidJson'));
	}
}

const MULTIPART_RE = /^multipart\/form-data\s*;\s*boundary=/;

/**
 * Liest einen multipart-Request (nur Endpunkte mit `multipart`): Content-Length ist Pflicht und
 * darf `maxBytes` nicht überschreiten (auch die tatsächlich gelesene Größe wird geprüft).
 * Textfelder → Objekt (für das `body`-Schema), Dateien → `files`.
 */
async function readMultipart(
	request: Request,
	limits: { maxBytes: number; maxFiles?: number }
): Promise<{ fields: Record<string, string>; files: File[] }> {
	const raw = request.headers.get('content-length');
	if (raw === null || !/^\d+$/.test(raw.trim())) {
		throw errors.badRequest(t('api.contentLengthRequired'));
	}
	const tooLarge = () =>
		errors.tooLarge(t('api.tooLargeMax', { mb: Math.floor(limits.maxBytes / (1024 * 1024)) }));
	if (Number(raw) > limits.maxBytes) throw tooLarge();
	const buffer = await readLimitedBody(request, limits.maxBytes, tooLarge);
	let form: FormData;
	try {
		form = await new Response(buffer as BodyInit, {
			headers: { 'content-type': request.headers.get('content-type') ?? '' }
		}).formData();
	} catch {
		throw errors.badRequest(t('api.invalidFormData'));
	}
	const fields: Record<string, string> = {};
	const files: File[] = [];
	const maxFiles = limits.maxFiles ?? 1;
	for (const [key, value] of form.entries()) {
		if (typeof value === 'string') {
			if (key === '__proto__') throw errors.badRequest(t('api.invalidFieldName'));
			if (Object.hasOwn(fields, key)) throw errors.badRequest(t('api.duplicateField', { key }));
			fields[key] = value;
		} else {
			if (files.length >= maxFiles) throw errors.badRequest(t('api.tooManyFiles'));
			files.push(value);
		}
	}
	return { fields, files };
}

async function logAccess(row: typeof schema.apiLog.$inferInsert): Promise<void> {
	try {
		await getDb().insert(schema.apiLog).values(row);
	} catch (e) {
		console.error('[api] Zugriffsprotokoll fehlgeschlagen', (e as Error).message);
	}
}

/** Endpunkte, die nicht im `api_log` landen (Health-Check alle 30 s) */
const UNLOGGED = new Set(['GET /health']);

/** Längere Pfadsegmente aus Buchstaben/Ziffern/`-_` gelten als Token oder ID und werden maskiert. */
const TOKENISH = /^[A-Za-z0-9_-]{16,}$/;

/**
 * Pfad für das Zugriffsprotokoll: bei einem Treffer das Endpunkt-Muster (`/api/v1/…/:token`) statt
 * des konkreten Pfads, sonst der Pfad mit maskierten token-artigen Segmenten. So landen Link-Tokens
 * öffentlicher Endpunkte nie im Klartext im `api_log`.
 */
export function apiLogPath(pathname: string, fullPath?: string | null): string {
	if (fullPath) return `${API_PREFIX}${fullPath}`.slice(0, 300);
	const masked = pathname
		.split('/')
		.map((seg) => {
			let s = seg;
			try {
				s = decodeURIComponent(seg);
			} catch {
				// ungültige Kodierung: Rohsegment prüfen
			}
			return TOKENISH.test(s) || s.length > 64 ? ':param' : seg;
		})
		.join('/');
	return masked.slice(0, 300);
}

interface State {
	ctx: RequestContext;
	apiKeyId: string | null;
	/** Gematchtes Endpunkt-Muster (ohne `/api/v1`) */
	pattern: string | null;
	/** Nicht protokollieren (siehe `UNLOGGED`) */
	skipLog: boolean;
}

async function execute(
	{ request, url, ip }: ApiRequestInput,
	requestId: string,
	state: State
): Promise<Response> {
	const pathname = url.pathname.startsWith(API_PREFIX)
		? url.pathname.slice(API_PREFIX.length)
		: url.pathname;
	const { match, pathExists, allowed } = matchEndpoint(request.method, pathname);
	if (!match) {
		if (!pathExists) throw errors.notFound(t('api.endpointNotFound'));
		const r = errorResponse(errors.methodNotAllowed(), requestId);
		r.headers.set('allow', allowed.join(', '));
		return r;
	}
	const { endpoint } = match;
	state.pattern = endpoint.fullPath;
	state.skipLog = UNLOGGED.has(`${endpoint.method} ${endpoint.fullPath}`);

	// Modulstatus zuerst: deaktivierte Module sind nicht erreichbar (auch nicht anonym)
	if (endpoint.moduleId !== 'core' && !(await isModuleEnabled(endpoint.moduleId))) {
		throw errors.moduleDisabled(endpoint.moduleId);
	}

	// Authentifizierung: API-Key oder Session
	const meta = { ip, requestId };
	const authz = request.headers.get('authorization');
	let viaSession = false;
	if (authz) {
		const m = /^Bearer\s+(\S+)$/i.exec(authz);
		if (!m) throw errors.unauthenticated(t('api.invalidAuthHeader'));
		const r = await resolveApiKey(m[1] as string, meta);
		if (!r) throw errors.unauthenticated(t('api.invalidApiKey'));
		state.ctx = r.ctx;
		state.apiKeyId = r.keyId;
	} else {
		const r = await resolveSession(request.headers, meta);
		if (r) {
			state.ctx = r.ctx;
			viaSession = true;
		} else {
			state.ctx = { ...anonymousContext(ip), requestId };
		}
	}

	// Ab hier in der Sprache des Kontos (Session oder Besitzer*in des API-Keys), sonst die des Requests
	const own = state.ctx.userId ? await userLocale(state.ctx.userId) : null;
	const run = () => authorized(request, url, ip, requestId, state, match, viaSession);
	if (own && own !== getLocale()) {
		return withLocale(own, () => run().catch((e: unknown) => errorResponse(e, requestId)));
	}
	return run();
}

async function authorized(
	request: Request,
	url: URL,
	ip: string | null,
	requestId: string,
	state: State,
	match: NonNullable<ReturnType<typeof matchEndpoint>['match']>,
	viaSession: boolean
): Promise<Response> {
	const { endpoint } = match;
	const params = match.params;
	const ctx = state.ctx;

	// CSRF: Session-Cookies nur mit gleicher Origin für schreibende Methoden
	const mutating = request.method !== 'GET' && request.method !== 'HEAD';
	if (viaSession && mutating && !sameOrigin(request)) {
		throw errors.forbidden(t('api.foreignOrigin'));
	}

	// Rate Limiting
	const limits = ctx.userId
		? (endpoint.rateLimit ?? DEFAULT_LIMIT)
		: (endpoint.rateLimit ?? ANON_LIMIT);
	const bucket = state.apiKeyId
		? `key:${state.apiKeyId}`
		: ctx.userId
			? `user:${ctx.userId}`
			: `ip:${ip ?? 'unknown'}`;
	const rl = hit(
		`api:${bucket}:${endpoint.method}:${endpoint.fullPath}`,
		limits.limit,
		limits.windowSec
	);
	if (!rl.allowed) {
		const r = errorResponse(errors.rateLimited(), requestId);
		r.headers.set('retry-after', String(rl.retryAfterSec));
		return r;
	}

	// Öffentliche Endpunkte: Gesamt-Bucket (IP-unabhängig) und nur JSON bei Mutationen
	if (endpoint.public) {
		const total = hit(
			`api:public:${endpoint.method}:${endpoint.fullPath}`,
			Math.max((endpoint.rateLimit?.limit ?? 0) * 20, 200),
			endpoint.rateLimit?.windowSec ?? 60
		);
		if (!total.allowed) {
			const r = errorResponse(errors.rateLimited(), requestId);
			r.headers.set('retry-after', String(total.retryAfterSec));
			return r;
		}
		if (mutating && !endpoint.multipart) {
			const ct = (request.headers.get('content-type') ?? '').toLowerCase();
			if (!/^application\/json\s*(;|$)/.test(ct)) {
				throw errors.badRequest(t('api.jsonRequired'));
			}
		}
	}
	// multipart-Endpunkte (nur öffentliche POSTs, siehe Registry): nur multipart/form-data
	if (endpoint.multipart && mutating) {
		const ct = (request.headers.get('content-type') ?? '').toLowerCase();
		if (!MULTIPART_RE.test(ct)) {
			throw errors.badRequest(t('api.multipartRequired'));
		}
	}

	// Autorisierung
	if (endpoint.permission !== null) {
		if (!ctx.userId) throw errors.unauthenticated();
		if (endpoint.sessionOnly && state.apiKeyId) {
			throw errors.forbidden(t('api.sessionOnly'));
		}
		if (!has(ctx, endpoint.permission)) {
			throw errors.forbidden(t('api.missingPermission', { permission: endpoint.permission }));
		}
	} else if (endpoint.authenticated) {
		if (!ctx.userId) throw errors.unauthenticated();
		if (endpoint.sessionOnly && state.apiKeyId) {
			throw errors.forbidden(t('api.sessionOnly'));
		}
	}

	// Validierung
	const parsedParams = endpoint.params ? endpoint.params.parse(params) : params;
	const rawQuery = Object.fromEntries(url.searchParams);
	const parsedQuery = endpoint.query ? endpoint.query.parse(rawQuery) : rawQuery;
	let body: unknown;
	let files: File[] | undefined;
	if (endpoint.multipart && mutating) {
		const parsed = await readMultipart(request, endpoint.multipart);
		files = parsed.files;
		body = endpoint.body ? endpoint.body.parse(parsed.fields) : undefined;
	} else {
		body = endpoint.body ? endpoint.body.parse(await readBody(request)) : undefined;
	}

	const result = await endpoint.handler({
		ctx,
		params: parsedParams as never,
		query: parsedQuery as never,
		body: body as never,
		request,
		...(files ? { files } : {})
	});
	const response =
		result instanceof Response
			? result
			: json({ data: result ?? null }, request.method === 'POST' ? 201 : 200);
	if (endpoint.public) response.headers.set('cache-control', 'no-store');
	response.headers.set('x-ratelimit-remaining', String(rl.remaining));
	return response;
}

/** Zentrale Verarbeitung aller `/api/v1/*`-Anfragen. */
export async function handleApiRequest(input: ApiRequestInput): Promise<Response> {
	const started = Date.now();
	const { request, url, ip } = input;
	// nur sichere IDs übernehmen (keine Steuerzeichen/Zeilenumbrüche in Logs), sonst neue UUID
	const requestId = requestIdFrom(request.headers);
	const state: State = {
		ctx: anonymousContext(ip),
		apiKeyId: null,
		pattern: null,
		skipLog: false
	};
	let response: Response;
	try {
		response = await execute(input, requestId, state);
	} catch (e) {
		response = errorResponse(e, requestId);
	}
	response.headers.set('x-request-id', requestId);
	// HEAD: gleiche Header wie GET, aber ohne Body
	if (request.method === 'HEAD' && response.body) {
		response.body.cancel().catch(() => undefined);
		response = new Response(null, { status: response.status, headers: response.headers });
	}
	if (state.skipLog) return response;
	void logAccess({
		id: newId(),
		requestId,
		method: request.method,
		path: apiLogPath(url.pathname, state.pattern),
		status: response.status,
		durationMs: Date.now() - started,
		actorType: state.ctx.actor.type,
		actorId: state.ctx.actor.id,
		apiKeyId: state.apiKeyId,
		ip
	});
	return response;
}
