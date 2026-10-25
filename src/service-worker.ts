/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/**
 * Service Worker der App (von SvelteKit unter `/service-worker.js` registriert): macht die App installierbar
 * (Home-Bildschirm) und zeigt Push-Benachrichtigungen (`core.notifications`).
 *
 * Bewusst **kein** Offline-Cache: Seiten und Daten kommen immer frisch vom Server, damit nach einem Update
 * keine veralteten Stände angezeigt werden.
 */
import { version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

interface PushData {
	title?: string;
	body?: string;
	url?: string;
	tag?: string;
}

sw.addEventListener('install', () => {
	void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(sw.clients.claim());
});

/** Nur Pfade dieser App öffnen (Schutz vor fremden Zielen im Push-Inhalt) */
function safeUrl(value: unknown): string {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
		return '/dashboard';
	}
	try {
		const url = new URL(value, sw.location.origin);
		return url.origin === sw.location.origin ? url.pathname + url.search + url.hash : '/dashboard';
	} catch {
		return '/dashboard';
	}
}

sw.addEventListener('push', (event) => {
	let data: PushData;
	try {
		data = (event.data?.json() as PushData) ?? {};
	} catch {
		data = { body: event.data?.text() };
	}
	const title = data.title || 'EP Intern';
	event.waitUntil(
		sw.registration.showNotification(title, {
			body: data.body ?? '',
			tag: data.tag,
			icon: '/icons/icon-192.png',
			badge: '/icons/badge-96.png',
			lang: 'de',
			data: { url: safeUrl(data.url) }
		})
	);
});

/**
 * Ziel eines Klicks merken, bis die App es abholt (`ep:pending-navigation`). Rückfall für Plattformen, die beim
 * Kaltstart der installierten App die Startseite statt der übergebenen Adresse öffnen (v. a. iOS).
 */
const PENDING_CACHE = 'ep-pending-navigation';
const PENDING_KEY = '/__ep-pending-navigation';
const PENDING_MAX_AGE_MS = 60_000;

async function rememberPending(url: string): Promise<void> {
	try {
		const cache = await caches.open(PENDING_CACHE);
		await cache.put(PENDING_KEY, new Response(JSON.stringify({ url, at: Date.now() })));
	} catch {
		// ohne Cache-API bleibt nur `openWindow` mit Zieladresse
	}
}

async function clearPending(): Promise<void> {
	try {
		await (await caches.open(PENDING_CACHE)).delete(PENDING_KEY);
	} catch {
		// nichts zu tun
	}
}

async function takePending(): Promise<string | null> {
	try {
		const cache = await caches.open(PENDING_CACHE);
		const res = await cache.match(PENDING_KEY);
		if (!res) return null;
		await cache.delete(PENDING_KEY);
		const { url, at } = (await res.json()) as { url?: string; at?: number };
		if (typeof at !== 'number' || Date.now() - at > PENDING_MAX_AGE_MS) return null;
		return safeUrl(url);
	} catch {
		return null;
	}
}

/** Offenes App-Fenster bitten, per SvelteKit-Navigation zum Ziel zu wechseln; `true`, wenn es bestätigt */
function askClientToNavigate(client: WindowClient, url: string): Promise<boolean> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => resolve(false), 1500);
		channel.port1.onmessage = (e) => {
			clearTimeout(timer);
			resolve((e.data as { ok?: boolean } | null)?.ok === true);
		};
		try {
			client.postMessage({ type: 'ep:navigate', url }, [channel.port2]);
		} catch {
			clearTimeout(timer);
			resolve(false);
		}
	});
}

/** Bevorzugt das sichtbare/aktive Fenster der App (z. B. die installierte App statt eines Browser-Tabs) */
function pickClient(windows: readonly WindowClient[]): WindowClient | null {
	const own = windows.filter((c) => {
		try {
			return new URL(c.url).origin === sw.location.origin;
		} catch {
			return false;
		}
	});
	return (
		own.find((c) => c.focused) ?? own.find((c) => c.visibilityState === 'visible') ?? own[0] ?? null
	);
}

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = safeUrl((event.notification.data as { url?: string } | null)?.url);
	event.waitUntil(
		(async () => {
			// Ziel immer zuerst merken: iOS hält eine Hintergrund-App angehalten, Nachrichten kommen dann erst
			// nach dem Aufwachen (oder gar nicht) an – die App holt das Ziel beim Sichtbarwerden selbst ab.
			await rememberPending(target);
			const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			const client = pickClient(windows);
			if (client) {
				// Fokus zuerst: nur innerhalb des Klick-Ereignisses erlaubt
				const focused = await client.focus().catch(() => client);
				if (await askClientToNavigate(focused, target)) return void (await clearPending());
				try {
					if (await focused.navigate(target)) return void (await clearPending());
				} catch {
					// nicht kontrolliertes Fenster oder `navigate` nicht unterstützt → neues Fenster
				}
			}
			await sw.clients.openWindow(target).catch(() => null);
			// iOS: `matchAll` findet die laufende App oft nicht, und `openWindow` holt sie nur nach vorne, ohne zu
			// navigieren. Darum das Ziel zusätzlich an alle App-Fenster senden – mehrfach, weil die App erst nach
			// dem Aufwachen zuhört. Doppeltes Öffnen verhindert die App selbst.
			await broadcastNavigate(target);
		})()
	);
});

const NAV_CHANNEL = 'ep-navigation';
const BROADCAST_DELAYS_MS = [0, 500, 1500, 3000];

async function broadcastNavigate(url: string): Promise<void> {
	let channel: BroadcastChannel;
	try {
		channel = new BroadcastChannel(NAV_CHANNEL);
	} catch {
		return;
	}
	let waited = 0;
	for (const delay of BROADCAST_DELAYS_MS) {
		await new Promise((r) => setTimeout(r, delay - waited));
		waited = delay;
		if (!(await hasPending())) break; // App hat das Ziel schon geöffnet
		channel.postMessage({ type: 'ep:navigate', url });
	}
	channel.close();
}

async function hasPending(): Promise<boolean> {
	try {
		return Boolean(await (await caches.open(PENDING_CACHE)).match(PENDING_KEY));
	} catch {
		return true;
	}
}

sw.addEventListener('message', (event) => {
	const data = event.data as { type?: string } | null;
	if (data?.type === 'ep:sw-version') {
		event.ports[0]?.postMessage({ version });
		return;
	}
	if (data?.type === 'ep:pending-clear') {
		event.waitUntil(clearPending());
		return;
	}
	if (data?.type !== 'ep:pending-navigation') return;
	const port = event.ports[0];
	if (!port) return;
	event.waitUntil(takePending().then((url) => port.postMessage({ url })));
});

/**
 * Abo wurde vom Browser erneuert/entzogen: neu anmelden, damit Push weiter ankommt. Ohne Sitzung schlägt
 * das fehl – dann muss die Person Push im Profil erneut aktivieren.
 */
sw.addEventListener('pushsubscriptionchange', (event) => {
	const e = event as Event & {
		oldSubscription?: PushSubscription | null;
		newSubscription?: PushSubscription | null;
		waitUntil(p: Promise<unknown>): void;
	};
	e.waitUntil(
		(async () => {
			const keyRes = await fetch('/api/v1/notifications/push/key', { credentials: 'same-origin' });
			if (!keyRes.ok) return;
			const { data } = (await keyRes.json()) as { data: { publicKey: string } };
			const sub =
				e.newSubscription ??
				(await sw.registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: base64UrlToBytes(data.publicKey)
				}));
			await fetch('/api/v1/notifications/push/subscriptions', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ ...sub.toJSON(), label: 'Erneuertes Gerät' })
			});
		})().catch(() => undefined)
	);
});

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const pad = '='.repeat((4 - (value.length % 4)) % 4);
	const raw = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}
