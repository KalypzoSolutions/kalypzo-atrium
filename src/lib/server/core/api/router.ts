import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { ApiErrorBody, RequestContext } from '$lib/sdk/types';
import { anonymousContext, resolveApiKey, resolveSession } from '../auth/context';
import { getDb, schema } from '../database/client';
import { env } from '../env';
import { errors, isCoreError } from '../errors';
import { isModuleEnabled } from '../modules/service';
import { has } from '../permissions/service';
import { hit } from '../rate-limit';
import { newId } from '../util';
import { matchEndpoint } from './registry';

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
	if (isCoreError(e)) {
		const body: ApiErrorBody = {
			error: { code: e.code, message: e.message, details: e.details, requestId }
		};
		return json(body, e.status);
	}
	console.error(`[api] ${requestId}`, e instanceof Error ? e.message : e);
	const body: ApiErrorBody = {
		error: { code: 'internal_error', message: 'Interner Serverfehler', requestId }
	};
	return json(body, 500);
}

function sameOrigin(request: Request): boolean {
	const origin = request.headers.get('origin');
	if (origin) return origin === env().ORIGIN || origin === new URL(request.url).origin;
	const site = request.headers.get('sec-fetch-site');
	return site === 'same-origin' || site === 'none';
}

async function readBody(request: Request): Promise<unknown> {
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_BODY_BYTES) throw errors.tooLarge('Anfrage ist zu gross');
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) throw errors.tooLarge('Anfrage ist zu gross');
	if (!text.trim()) return undefined;
	try {
		return JSON.parse(text);
	} catch {
		throw errors.badRequest('Ungueltiges JSON');
	}
}

async function logAccess(row: typeof schema.apiLog.$inferInsert): Promise<void> {
	try {
		await getDb().insert(schema.apiLog).values(row);
	} catch (e) {
		console.error('[api] Zugriffsprotokoll fehlgeschlagen', (e as Error).message);
	}
}

interface State {
	ctx: RequestContext;
	apiKeyId: string | null;
}

async function execute(
	{ request, url, ip }: ApiRequestInput,
	requestId: string,
	state: State
): Promise<Response> {
	const pathname = url.pathname.startsWith(API_PREFIX)
		? url.pathname.slice(API_PREFIX.length)
		: url.pathname;
	const { match, pathExists } = matchEndpoint(request.method, pathname);
	if (!match) {
		throw pathExists ? errors.methodNotAllowed() : errors.notFound('Endpunkt nicht gefunden');
	}
	const { endpoint, params } = match;

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
		if (!m) throw errors.unauthenticated('Ungueltiger Authorization-Header');
		const r = await resolveApiKey(m[1] as string, meta);
		if (!r) throw errors.unauthenticated('Ungueltiger, abgelaufener oder widerrufener API-Key');
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
	const ctx = state.ctx;

	// CSRF: Session-Cookies nur mit gleicher Origin fuer schreibende Methoden
	const mutating = request.method !== 'GET' && request.method !== 'HEAD';
	if (viaSession && mutating && !sameOrigin(request)) {
		throw errors.forbidden('Anfrage von fremder Origin abgelehnt');
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

	// Oeffentliche Endpunkte: Gesamt-Bucket (IP-unabhaengig) und nur JSON bei Mutationen
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
		if (mutating) {
			const ct = (request.headers.get('content-type') ?? '').toLowerCase();
			if (!/^application\/json\s*(;|$)/.test(ct)) {
				throw errors.badRequest('Content-Type application/json erforderlich');
			}
		}
	}

	// Autorisierung
	if (endpoint.permission !== null) {
		if (!ctx.userId) throw errors.unauthenticated();
		if (endpoint.sessionOnly && state.apiKeyId) {
			throw errors.forbidden('Dieser Endpunkt ist nicht per API-Key erreichbar');
		}
		if (!has(ctx, endpoint.permission)) {
			throw errors.forbidden(`Berechtigung fehlt: ${endpoint.permission}`);
		}
	} else if (endpoint.authenticated) {
		if (!ctx.userId) throw errors.unauthenticated();
		if (endpoint.sessionOnly && state.apiKeyId) {
			throw errors.forbidden('Dieser Endpunkt ist nicht per API-Key erreichbar');
		}
	}

	// Validierung
	const parsedParams = endpoint.params ? endpoint.params.parse(params) : params;
	const rawQuery = Object.fromEntries(url.searchParams);
	const parsedQuery = endpoint.query ? endpoint.query.parse(rawQuery) : rawQuery;
	const body = endpoint.body ? endpoint.body.parse(await readBody(request)) : undefined;

	const result = await endpoint.handler({
		ctx,
		params: parsedParams as never,
		query: parsedQuery as never,
		body: body as never,
		request
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
	const requestId = request.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
	const state: State = { ctx: anonymousContext(ip), apiKeyId: null };
	let response: Response;
	try {
		response = await execute(input, requestId, state);
	} catch (e) {
		response = errorResponse(e, requestId);
	}
	response.headers.set('x-request-id', requestId);
	void logAccess({
		id: newId(),
		requestId,
		method: request.method,
		path: url.pathname.slice(0, 300),
		status: response.status,
		durationMs: Date.now() - started,
		actorType: state.ctx.actor.type,
		actorId: state.ctx.actor.id,
		apiKeyId: state.apiKeyId,
		ip
	});
	return response;
}
