/**
 * #63: `hooks.server.ts` – Login-Guard, Modulsperre, Legacy-Redirects, Security-Header und
 * Theme-/Akzent-Ersetzung in `app.html`. Getestet wird der exportierte `handle` (Sequenz
 * headers → init → Better Auth → guard) mit gestubbtem `RequestEvent`; Core-Dienste sind gemockt.
 */
import { THEME_PRESETS } from '$lib/appearance/presets';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const state = vi.hoisted(() => ({
	session: null as null | { user: { id: string }; ctx: unknown; sessionId: string },
	enabled: new Set<string>(['members', 'actions']),
	prefs: null as null | { accentColor: string; density: string; activeTheme?: unknown },
	prefsError: false,
	systemAccent: null as string | null,
	resolveSession: 0
}));

vi.mock('$app/environment', () => ({
	building: true,
	dev: false,
	browser: false,
	version: 'test'
}));
vi.mock('$lib/server/core/init', () => ({ initCore: async () => {} }));
vi.mock('$lib/server/core/jobs', () => ({ startJobRunner: () => {} }));
vi.mock('$lib/server/core/auth', () => ({ getAuth: () => ({}) }));
vi.mock('better-auth/svelte-kit', () => ({
	svelteKitHandler: ({
		event,
		resolve
	}: {
		event: RequestEvent;
		resolve: (e: RequestEvent) => Promise<Response>;
	}) => resolve(event)
}));
vi.mock('$lib/server/core/auth/context', () => ({
	anonymousContext: (ip: string | null) => ({ userId: null, ip, permissions: new Set() }),
	resolveSession: async () => {
		state.resolveSession++;
		return state.session;
	}
}));
vi.mock('$lib/server/core/modules/service', () => ({
	isModuleEnabled: async (id: string) => state.enabled.has(id)
}));
vi.mock('$lib/server/core/settings/service', () => ({
	getSetting: async () => state.systemAccent
}));
vi.mock('$lib/server/core/settings/user-prefs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/core/settings/user-prefs')>()),
	loadUserPrefs: async () => {
		if (state.prefsError) throw new Error('DB weg');
		return state.prefs;
	}
}));

const { handle } = await import('../../src/hooks.server');
// `sequence` liest den Request-Store von SvelteKit (wie im echten Server über `with_request_store`).
// Interner Export ohne Typdeklaration → über einen Variablen-Pfad laden.
const KIT_INTERNAL = '@sveltejs/kit/internal/server';
const { with_request_store } = (await import(/* @vite-ignore */ KIT_INTERNAL)) as {
	with_request_store: <T>(store: unknown, fn: () => T) => T;
};

const TEMPLATE =
	'<html lang="de" class="%app.theme%" data-density="%app.density%" data-app-theme="%app.apptheme%" style="%app.style%"><body></body></html>';

interface Opts {
	https?: boolean;
	cookies?: Record<string, string>;
	headers?: Record<string, string>;
	/** Header, die die Route selbst setzt */
	responseHeaders?: Record<string, string>;
	html?: string;
}

function makeEvent(path: string, o: Opts = {}): RequestEvent {
	const url = new URL(`${o.https ? 'https' : 'http'}://intern.test${path}`);
	return {
		url,
		request: new Request(url, { headers: o.headers }),
		cookies: { get: (n: string) => o.cookies?.[n] },
		locals: {},
		params: {},
		route: { id: null },
		getClientAddress: () => '203.0.113.7',
		setHeaders: () => {},
		isDataRequest: false,
		isSubRequest: false,
		platform: undefined,
		fetch
	} as unknown as RequestEvent;
}

async function run(path: string, o: Opts = {}) {
	const event = makeEvent(path, o);
	let resolved = false;
	const store = {
		event,
		state: { tracing: { record_span: ({ fn }: { fn: (c: unknown) => unknown }) => fn({}) } }
	};
	const response = await with_request_store(store, () =>
		handle({
			event,
			resolve: async (e, opts) => {
				resolved = true;
				const html = opts?.transformPageChunk
					? ((await opts.transformPageChunk({ html: o.html ?? TEMPLATE, done: true })) ?? '')
					: (o.html ?? TEMPLATE);
				return new Response(html, {
					headers: { 'content-type': 'text/html', ...o.responseHeaders }
				});
			}
		})
	);
	return { response, event, resolved, html: await response.clone().text() };
}

/** Guard wirft `redirect(...)` – Status und Ziel auslesen */
async function redirected(path: string, o: Opts = {}) {
	try {
		await run(path, o);
	} catch (e) {
		return e as { status: number; location: string };
	}
	throw new Error(`kein Redirect für ${path}`);
}

const login = () => {
	state.session = { user: { id: 'u1' }, ctx: { userId: 'u1' }, sessionId: 's1' };
};

beforeEach(() => {
	state.session = null;
	state.enabled = new Set(['members', 'actions']);
	state.prefs = null;
	state.prefsError = false;
	state.systemAccent = null;
	state.resolveSession = 0;
});

describe('guard: Login-Pflicht', () => {
	it('anonym auf interne Seite → 303 auf /login mit redirectTo (Pfad + Query)', async () => {
		expect(await redirected('/modules/members?open=abc')).toMatchObject({
			status: 303,
			location: '/login?redirectTo=%2Fmodules%2Fmembers%3Fopen%3Dabc'
		});
		expect(await redirected('/dashboard')).toMatchObject({
			status: 303,
			location: '/login?redirectTo=%2Fdashboard'
		});
	});

	it('anonym auf / → /login ohne redirectTo', async () => {
		expect(await redirected('/')).toMatchObject({ status: 303, location: '/login' });
	});

	it('öffentliche Seiten exakt (/login, /forgot-password, /reset-password), Unterpfade nicht', async () => {
		for (const p of ['/login', '/forgot-password', '/reset-password']) {
			expect((await run(p)).response.status, p).toBe(200);
		}
		expect(await redirected('/login/extra')).toMatchObject({ status: 303 });
		expect(await redirected('/loginx')).toMatchObject({ status: 303 });
	});

	it('öffentliche Modulseiten /p/<modul>/… ohne Login, aber nur bei aktivem Modul', async () => {
		expect((await run('/p/actions/anmeldung/tok')).response.status).toBe(200);
		state.enabled.delete('actions');
		const r = await run('/p/actions/anmeldung/tok');
		expect(r.response.status).toBe(404);
		expect(r.html).toBe('Modul nicht verfügbar');
		expect(r.resolved).toBe(false);
	});

	it('API-Pfade leitet der Guard nie um (API authentifiziert selbst)', async () => {
		const r = await run('/api/v1/users');
		expect(r.response.status).toBe(200);
		expect(r.resolved).toBe(true);
		// Für API-Pfade wird keine Seiten-Session geladen
		expect(state.resolveSession).toBe(0);
		expect((await run('/api/auth/get-session')).response.status).toBe(200);
	});

	it('angemeldet: Seiten erreichbar, Session landet in locals', async () => {
		login();
		const r = await run('/dashboard');
		expect(r.response.status).toBe(200);
		expect(r.event.locals.user).toEqual({ id: 'u1' });
		expect(r.event.locals.sessionId).toBe('s1');
	});
});

describe('guard: Modulsperre', () => {
	it('/modules/<deaktiviert>/… → 404, aktiv → durchgereicht', async () => {
		login();
		expect((await run('/modules/members')).response.status).toBe(200);
		expect((await run('/modules/members/groups')).response.status).toBe(200);
		const r = await run('/modules/treasury/payers');
		expect(r.response.status).toBe(404);
		expect(r.resolved).toBe(false);
	});

	it('anonym auf deaktiviertes Modul → Login zuerst (Existenz nicht verraten)', async () => {
		expect(await redirected('/modules/treasury')).toMatchObject({ status: 303 });
	});
});

describe('guard: alte Verwaltungs-URLs', () => {
	it('308 auf /admin/… mit Query, auch ohne Login', async () => {
		expect(await redirected('/users?q=max')).toMatchObject({
			status: 308,
			location: '/admin/users?q=max'
		});
		expect(await redirected('/modules')).toMatchObject({ status: 308, location: '/admin/modules' });
		expect(await redirected('/settings/storage')).toMatchObject({
			status: 308,
			location: '/admin/settings/storage'
		});
	});

	it('/modules/<id> ist keine Legacy-URL', async () => {
		login();
		expect((await run('/modules/actions')).response.status).toBe(200);
	});
});

describe('init: Request-ID und Client-IP', () => {
	it('übernimmt eine gültige x-request-id und ersetzt einen gefälschten IP-Header', async () => {
		login();
		const r = await run('/dashboard', {
			headers: { 'x-request-id': 'r'.repeat(64), 'x-ep-client-ip': '6.6.6.6' }
		});
		expect(r.event.locals.requestId).toBe('r'.repeat(64));
		expect(r.event.request.headers.get('x-ep-client-ip')).toBe('203.0.113.7');
	});

	it('ersetzt zu lange oder unsichere x-request-id durch eine UUID (#72, 06-15)', async () => {
		for (const bad of ['r'.repeat(80), 'kurz', 'abc def ghi', 'abc%0d%0aFAKE', 'ab;cd=efgh']) {
			const r = await run('/login', { headers: { 'x-request-id': bad } });
			expect(r.event.locals.requestId).toMatch(/^[0-9a-f-]{36}$/);
		}
	});

	it('ohne x-request-id wird eine UUID vergeben', async () => {
		const r = await run('/login');
		expect(r.event.locals.requestId).toMatch(/^[0-9a-f-]{36}$/);
		expect(r.event.locals.user).toBeNull();
	});
});

describe('headers: Security-Header', () => {
	it('setzt nosniff, Referrer-Policy, Permissions-Policy und x-frame-options DENY', async () => {
		const { response } = await run('/login');
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('permissions-policy')).toBe(
			'camera=(), microphone=(), geolocation=()'
		);
		expect(response.headers.get('x-frame-options')).toBe('DENY');
	});

	it('SAMEORIGIN nur für /admin/settings/mail-preview (exakt)', async () => {
		login();
		expect(
			(await run('/admin/settings/mail-preview')).response.headers.get('x-frame-options')
		).toBe('SAMEORIGIN');
		expect(
			(await run('/admin/settings/mail-preview/x')).response.headers.get('x-frame-options')
		).toBe('DENY');
		expect((await run('/admin/settings/mail')).response.headers.get('x-frame-options')).toBe(
			'DENY'
		);
	});

	it('HSTS nur bei https', async () => {
		expect((await run('/login')).response.headers.get('strict-transport-security')).toBeNull();
		expect(
			(await run('/login', { https: true })).response.headers.get('strict-transport-security')
		).toBe('max-age=31536000; includeSubDomains');
	});

	it('cache-control: no-store als Standard, eigener Wert bleibt, /_app/ unberührt', async () => {
		expect((await run('/login')).response.headers.get('cache-control')).toBe('no-store');
		expect(
			(
				await run('/login', { responseHeaders: { 'cache-control': 'private, max-age=300' } })
			).response.headers.get('cache-control')
		).toBe('private, max-age=300');
		// Statische Assets liefert adapter-node vor den Hooks aus; hier angemeldet, damit der Guard nicht greift
		login();
		const asset = await run('/_app/immutable/x.js');
		expect(asset.response.headers.get('cache-control')).toBeNull();
		expect(asset.response.headers.get('x-frame-options')).toBe('DENY');
	});

	it('auch die 404 der Modulsperre bekommt die Security-Header', async () => {
		state.enabled.clear();
		const { response } = await run('/p/actions/anmeldung/tok');
		expect(response.status).toBe(404);
		expect(response.headers.get('x-frame-options')).toBe('DENY');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});

describe('headers: Theme, Dichte und Akzentfarbe in app.html', () => {
	it('ohne Angaben: hell, comfortable, kein Style', async () => {
		const { html } = await run('/login');
		expect(html).toContain('class=""');
		expect(html).toContain('data-density="comfortable"');
		expect(html).toContain('style=""');
		expect(html).not.toContain('%app.');
	});

	it('Cookie theme=dark → Klasse dark; andere Werte → hell', async () => {
		expect((await run('/login', { cookies: { theme: 'dark' } })).html).toContain('class="dark"');
		expect((await run('/login', { cookies: { theme: 'system' } })).html).toContain('class=""');
		expect((await run('/login', { cookies: { theme: '"><script>' } })).html).toContain('class=""');
	});

	it('Benutzer-Einstellungen (Akzent, Dichte) gewinnen gegenüber dem System-Akzent', async () => {
		login();
		state.systemAccent = '#000000';
		state.prefs = { accentColor: '#AA00ff', density: 'compact' };
		const { html } = await run('/dashboard');
		expect(html).toContain('style="--accent-color:#aa00ff"');
		expect(html).toContain('data-density="compact"');
	});

	it('ohne Benutzer-Akzent gilt der System-Akzent; ungültige Werte werden verworfen', async () => {
		state.systemAccent = '#123abc';
		expect((await run('/login')).html).toContain('style="--accent-color:#123abc"');
		state.systemAccent = 'red;background:url(x)';
		expect((await run('/login')).html).toContain('style=""');
	});

	it('aktives Theme: Hintergrund-Variablen, data-app-theme und Theme-Akzent', async () => {
		login();
		state.systemAccent = '#000000';
		state.prefs = {
			accentColor: '#aa00ff',
			density: 'comfortable',
			activeTheme: THEME_PRESETS[0]
		};
		const { html } = await run('/dashboard');
		expect(html).toContain('data-app-theme="on"');
		expect(html).toContain(`--accent-color:${THEME_PRESETS[0]!.accent}`);
		expect(html).toContain('--app-bg-light:linear-gradient(');
		expect(html).toContain('--app-sidebar-dark:');
	});

	it('ohne Theme bleibt data-app-theme leer', async () => {
		expect((await run('/login')).html).toContain('data-app-theme=""');
	});

	it('Fehler beim Laden der Einstellungen → Standardwerte statt 500', async () => {
		login();
		state.prefsError = true;
		const r = await run('/dashboard');
		expect(r.response.status).toBe(200);
		expect(r.html).toContain('data-density="comfortable"');
		expect(r.html).toContain('style=""');
	});

	it('Seiten ohne Platzhalter bleiben unverändert', async () => {
		const html = '<p>kein Platzhalter</p>';
		expect((await run('/login', { html })).html).toBe(html);
	});
});
