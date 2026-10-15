import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { randomUUID } from 'node:crypto';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { anonymousContext, resolveSession } from '$lib/server/core/auth/context';
import { getAuth } from '$lib/server/core/auth';
import { initCore } from '$lib/server/core/init';
import { isModuleEnabled } from '$lib/server/core/modules/service';

const PUBLIC_PAGES = ['/login', '/forgot-password', '/reset-password'];
/** Oeffentliche Modulseiten (`/p/<moduleId>/…`): keine Session noetig */
const PUBLIC_PREFIXES = ['/p/'];

if (!building) {
	// Startsequenz (Migrationen, Registrierung, Synchronisation). Fehler beenden den Start laut.
	initCore().catch((e) => {
		console.error('[core] Initialisierung fehlgeschlagen:', e);
		process.exit(1);
	});
}

function clientIp(event: Parameters<Handle>[0]['event']): string | null {
	try {
		return event.getClientAddress();
	} catch {
		return null;
	}
}

const init: Handle = async ({ event, resolve }) => {
	await initCore();
	const requestId = event.request.headers.get('x-request-id')?.slice(0, 64) || randomUUID();
	const ip = clientIp(event);
	event.locals.requestId = requestId;
	event.locals.ctx = anonymousContext(ip);
	event.locals.user = null;
	event.locals.sessionId = null;

	// Better-Auth-Endpunkte loest Better Auth selbst auf
	const isApi = event.url.pathname.startsWith('/api/');
	if (!isApi || event.url.pathname.startsWith('/api/v1/')) {
		// API-v1 authentifiziert selbst (Session oder API-Key); fuer Seiten hier die Session laden
		if (!isApi) {
			const session = await resolveSession(event.request.headers, { ip, requestId });
			if (session) {
				event.locals.ctx = session.ctx;
				event.locals.user = session.user;
				event.locals.sessionId = session.sessionId;
			}
		}
	}
	return resolve(event);
};

const authHandler: Handle = ({ event, resolve }) =>
	svelteKitHandler({ auth: getAuth(), event, resolve, building });

const guard: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isApi = path.startsWith('/api/');
	if (!isApi) {
		const isPublic = PUBLIC_PAGES.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
		if (!event.locals.user && !isPublic) {
			throw redirect(
				303,
				`/login${path !== '/' ? `?redirectTo=${encodeURIComponent(path + event.url.search)}` : ''}`
			);
		}
		// Moduloberflaeche: deaktivierte Module sind nicht erreichbar
		const m = /^\/(?:modules|p)\/([^/]+)/.exec(path);
		if (m && !(await isModuleEnabled(m[1] as string))) {
			return new Response('Modul nicht verfuegbar', { status: 404 });
		}
	}
	return resolve(event);
};

const headers: Handle = async ({ event, resolve }) => {
	const theme = event.cookies.get('theme');
	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%app.theme%', theme === 'dark' ? 'dark' : '')
	});
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	response.headers.set('x-frame-options', 'DENY');
	response.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
	if (event.url.protocol === 'https:') {
		response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	}
	if (!event.url.pathname.startsWith('/_app/')) {
		response.headers.set('cache-control', response.headers.get('cache-control') ?? 'no-store');
	}
	return response;
};

export const handle: Handle = sequence(headers, init, authHandler, guard);

export const handleError: HandleServerError = ({ error, event }) => {
	console.error(
		`[server] ${event.locals.requestId}`,
		error instanceof Error ? error.message : error
	);
	return { message: 'Es ist ein interner Fehler aufgetreten.', requestId: event.locals.requestId };
};
