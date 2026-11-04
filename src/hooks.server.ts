import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { building } from '$app/environment';
import '$lib/zod-locale';
import { t } from '$lib/i18n';
import { legacyAdminRedirect } from '$lib/server/core/admin-redirects';
import { requestIdFrom } from '$lib/server/core/api/request-id';
import { anonymousContext, resolveSession } from '$lib/server/core/auth/context';
import { getAuth } from '$lib/server/core/auth';
import { activeImpersonation, stopImpersonation } from '$lib/server/core/auth/admin/impersonation';
import { applyClientIpHeader, clientAddress } from '$lib/server/core/auth/client-ip';
import { logError } from '$lib/server/core/db-errors';
import { initCore } from '$lib/server/core/init';
import { installShutdownHandlers, runVerifyAndExit } from '$lib/server/core/lifecycle';
import { startJobRunner } from '$lib/server/core/jobs';
import { brandVersion, brandingState } from '$lib/server/core/branding';
import { isModuleEnabled } from '$lib/server/core/modules/service';
import { getSetting } from '$lib/server/core/settings/service';
import { LOCALE_COOKIE, resolveLocale, withLocale } from '$lib/server/core/i18n/locale';
import { applyAppearance, loadUserPrefs } from '$lib/server/core/settings/user-prefs';

const PUBLIC_PAGES = [
	'/login',
	'/forgot-password',
	'/reset-password',
	'/manifest.webmanifest',
	// QR-Anmeldung: Code anfordern/Stand abfragen/einlösen (die Bestätigungsseite `/login/qr/<token>` braucht Login)
	'/login/qr',
	'/login/qr/claim'
];
/** Öffentliche Modulseiten (`/p/<moduleId>/…`) sowie Logo/Icons (`/branding/…`): keine Session nötig */
const PUBLIC_PREFIXES = ['/p/', '/branding/'];

if (!building && process.env.ATRIUM_VERIFY_ONLY === '1') {
	// Probelauf des Supervisors: nur Module prüfen, keine Datenbank, dann beenden (lifecycle.ts)
	runVerifyAndExit();
} else if (!building) {
	installShutdownHandlers();
	// Startsequenz (Migrationen, Registrierung, Synchronisation). Fehler beenden den Start laut.
	initCore()
		.then(() => startJobRunner())
		.catch((e) => {
			console.error('[core] Initialisierung fehlgeschlagen:', e);
			process.exit(1);
		});
}

const init: Handle = async ({ event, resolve }) => {
	await initCore();
	const requestId = requestIdFrom(event.request.headers);
	const ip = clientAddress(event);
	// Einzige IP-Quelle für Better Auth (Rate-Limit, Session-IP) und Audit: eingehender gleichnamiger
	// Header des Clients wird verworfen, dann die von adapter-node ermittelte Adresse gesetzt (#42)
	try {
		applyClientIpHeader(event.request.headers, ip);
	} catch (e) {
		console.error('[core] Client-IP-Header nicht setzbar:', (e as Error)?.message);
	}
	event.locals.requestId = requestId;
	event.locals.ctx = anonymousContext(ip);
	event.locals.user = null;
	event.locals.sessionId = null;
	event.locals.impersonation = null;

	// Better-Auth-Endpunkte löst Better Auth selbst auf
	const isApi = event.url.pathname.startsWith('/api/');
	if (!isApi || event.url.pathname.startsWith('/api/v1/')) {
		// API-v1 authentifiziert selbst (Session oder API-Key); für Seiten hier die Session laden
		if (!isApi) {
			const session = await resolveSession(event.request.headers, { ip, requestId });
			if (session) {
				event.locals.ctx = session.ctx;
				event.locals.user = session.user;
				event.locals.sessionId = session.sessionId;
				event.locals.impersonation = session.impersonation;
			}
		}
	}
	const locale = await resolveLocale({
		userId: event.locals.user?.id,
		cookie: event.cookies.get(LOCALE_COOKIE),
		acceptLanguage: event.request.headers.get('accept-language')
	});
	event.locals.locale = locale;
	// Alles Weitere (Auth, Guard, Load, SSR, API) läuft in dieser Sprache (`t()` auf dem Server)
	return withLocale(locale, () => resolve(event));
};

/** Better-Auth-Pfade, die während „Als Person handeln“ erlaubt bleiben */
const AUTH_PATHS_WHILE_IMPERSONATING = new Set(['/api/auth/get-session', '/api/auth/sign-out']);

/**
 * Während „Als Person handeln“ gehört die Better-Auth-Sitzung der **Admin-Person**: Passwort, 2FA, Sitzungen,
 * E-Mail usw. träfen deren Konto. Deshalb sind diese Pfade gesperrt; Abmelden beendet zuerst das Handeln.
 */
const impersonationAuthGuard: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	// Ohne Sitzungs-Cookie (Anmelden, Passwort vergessen …) keine zusätzliche Abfrage
	if (
		!path.startsWith('/api/auth/') ||
		!event.request.headers.get('cookie')?.includes('session_token')
	)
		return resolve(event);
	const session = await Promise.resolve()
		.then(() => getAuth().api.getSession({ headers: event.request.headers }))
		.catch(() => null);
	if (!session) return resolve(event);
	const imp = await activeImpersonation(session.session.id);
	if (!imp) return resolve(event);
	if (path === '/api/auth/sign-out') {
		await stopImpersonation(session.session.id);
		return resolve(event);
	}
	if (AUTH_PATHS_WHILE_IMPERSONATING.has(path)) return resolve(event);
	return new Response(
		JSON.stringify({ message: t('admin-users.server.blockedWhileImpersonating') }),
		{ status: 403, headers: { 'content-type': 'application/json' } }
	);
};

const authHandler: Handle = ({ event, resolve }) =>
	svelteKitHandler({ auth: getAuth(), event, resolve, building });

/** Seiten, die bei „Passwort ändern“-Pflicht erreichbar bleiben (Profil, Abmelden, Beenden des Handelns) */
const MUST_CHANGE_ALLOWED = ['/profile', '/admin/impersonation/stop'];

const guard: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isApi = path.startsWith('/api/');
	if (!isApi) {
		// Alte Verwaltungs-URLs (Lesezeichen) auf `/admin/…` umleiten, Query bleibt erhalten
		const moved = legacyAdminRedirect(path);
		if (moved) throw redirect(308, moved + event.url.search);
		const isPublic = PUBLIC_PAGES.includes(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));
		if (!event.locals.user && !isPublic) {
			throw redirect(
				303,
				`/login${path !== '/' ? `?redirectTo=${encodeURIComponent(path + event.url.search)}` : ''}`
			);
		}
		// Von der Verwaltung gesetztes Passwort: zuerst selbst ändern (nicht während „Als Person handeln“)
		if (
			event.locals.user &&
			!event.locals.impersonation &&
			!isPublic &&
			!MUST_CHANGE_ALLOWED.some((p) => path === p || path.startsWith(`${p}/`)) &&
			!path.startsWith('/_app/') &&
			event.locals.user.mustChangePassword
		) {
			throw redirect(303, '/profile?tab=security&mustChange=1');
		}
		// Moduloberfläche (auch eingebettet): deaktivierte Module sind nicht erreichbar
		const m = /^\/(?:modules|p|embed)\/([^/]+)/.exec(path);
		if (m && !(await isModuleEnabled(m[1] as string))) {
			return new Response(t('core-server.moduleUnavailable'), { status: 404 });
		}
	}
	return resolve(event);
};

/** Akzentfarbe (Theme, Benutzer oder System), Dichte und Theme für die Platzhalter in `app.html`; Fehler = Standard. */
async function appearanceFor(event: Parameters<Handle>[0]['event']) {
	try {
		const prefs = event.locals.user ? await loadUserPrefs(event.locals.user.id) : null;
		const accent =
			prefs?.activeTheme?.accent ||
			prefs?.accentColor ||
			(await getSetting<string>('core.design.accentColor'));
		return {
			accent,
			density: prefs?.density ?? 'comfortable',
			appTheme: prefs?.activeTheme ?? null
		};
	} catch {
		return { accent: null, density: 'comfortable', appTheme: null };
	}
}

/** Für Attributwerte in `app.html` (Systemname) */
function escapeAttr(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

const headers: Handle = async ({ event, resolve }) => {
	let appearance: ReturnType<typeof appearanceFor> | undefined;
	let brand: Promise<string> | undefined;
	let appName: Promise<string> | undefined;
	const response = await resolve(event, {
		// Läuft beim Rendern (nach Session und Layout-Load): der Theme-Cookie ist dann bereits abgeglichen
		transformPageChunk: async ({ html }) => {
			if (!html.includes('%app.')) return html;
			appearance ??= appearanceFor(event);
			brand ??= brandingState().then(brandVersion);
			appName ??= getSetting<string>('core.system.name')
				.then((n) => escapeAttr(String(n || 'Kalypzo Atrium').slice(0, 80)))
				.catch(() => 'Kalypzo Atrium');
			const [a, v, name] = await Promise.all([appearance, brand, appName]);
			// Favicon/Apple-Icon aus dem Logo: Version in der URL, damit Browser ein neues Logo laden
			const lang = event.locals.locale ?? 'de';
			const filled = html
				.replaceAll('%app.brand%', v)
				.replaceAll('%app.lang%', lang)
				.replaceAll('%app.name%', name);
			return applyAppearance(filled, {
				theme: event.cookies.get('theme'),
				density: a.density,
				accent: a.accent,
				appTheme: a.appTheme
			});
		}
	});
	response.headers.set('x-content-type-options', 'nosniff');
	response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
	// Nur die E-Mail-Vorschau (iframe in den Einstellungen) und Embed-Seiten (`/embed/<modul>/…`, iframe in
	// anderen Modulen) dürfen von der eigenen Seite eingebettet werden
	const embedPage = event.url.pathname.startsWith('/embed/');
	const embeddable = embedPage || event.url.pathname === '/admin/settings/mail-preview';
	response.headers.set('x-frame-options', embeddable ? 'SAMEORIGIN' : 'DENY');
	if (embedPage) {
		const csp = response.headers.get('content-security-policy');
		if (csp) {
			response.headers.set(
				'content-security-policy',
				csp.replace(/frame-ancestors 'none'/, "frame-ancestors 'self'")
			);
		}
	}
	response.headers.set('permissions-policy', 'camera=(self), microphone=(), geolocation=()');
	if (event.url.protocol === 'https:') {
		response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
	}
	if (!event.url.pathname.startsWith('/_app/')) {
		response.headers.set('cache-control', response.headers.get('cache-control') ?? 'no-store');
	}
	return response;
};

export const handle: Handle = sequence(headers, init, impersonationAuthGuard, authHandler, guard);

export const handleError: HandleServerError = ({ error, event }) => {
	// Parameterfrei loggen (keine SQL-Werte), Stack nur serverseitig (#56)
	logError(`[server] ${event.locals.requestId}`, error, { requestId: event.locals.requestId });
	return { message: t('core-server.internalError'), requestId: event.locals.requestId };
};
