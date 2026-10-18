import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { randomUUID } from 'node:crypto';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import { anonymousContext, resolveSession } from '$lib/server/core/auth/context';
import { getAuth } from '$lib/server/core/auth';
import { initCore } from '$lib/server/core/init';
import { startJobRunner } from '$lib/server/core/jobs';
import { isModuleEnabled } from '$lib/server/core/modules/service';
import { getSetting } from '$lib/server/core/settings/service';
import { applyAppearance, loadUserPrefs } from '$lib/server/core/settings/user-prefs';

const PUBLIC_PAGES = ['/login', '/forgot-password', '/reset-password'];
/** Oeffentliche Modulseiten (`/p/<moduleId>/…`): keine Session noetig */
const PUBLIC_PREFIXES = ['/p/'];

if (!building) {
	// Startsequenz (Migrationen, Registrierung, Synchronisation). Fehler beenden den Start laut.
	initCore()
		.then(() => startJobRunner())
		.catch((e) => {
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

/** Akzentfarbe (Benutzer oder System) und Dichte fuer die Platzhalter in `app.html`; Fehler = Standard. */
async function appearanceFor(event: Parameters<Handle>[0]['event']) {
	try {
		const prefs = event.locals.user ? await loadUserPrefs(event.locals.user.id) : null;
		const accent = prefs?.accentColor || (await getSetting<string>('core.design.accentColor'));
		return { accent, density: prefs?.density ?? 'comfortable' };
	} catch {
		return { accent: null, density: 'comfortable' };
	}
}

const headers: Handle = async ({ event, resolve }) => {
	let appearance: ReturnType<typeof appearanceFor> | undefined;
	const response = await resolve(event, {
		// Laeuft beim Rendern (nach Session und Layout-Load): der Theme-Cookie ist dann bereits abgeglichen
		transformPageChunk: async ({ html }) => {
			if (!html.includes('%app.')) return html;
			appearance ??= appearanceFor(event);
			const a = await appearance;
			return applyAppearance(html, {
				theme: event.cookies.get('theme'),
				density: a.density,
				accent: a.accent
			});
		}
	});
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	// Nur die E-Mail-Vorschau darf von der eigenen Seite eingebettet werden (iframe in den Einstellungen)
	const embeddable = event.url.pathname === '/settings/mail-preview';
	response.headers.set('x-frame-options', embeddable ? 'SAMEORIGIN' : 'DENY');
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
