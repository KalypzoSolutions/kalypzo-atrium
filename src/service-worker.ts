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

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = safeUrl((event.notification.data as { url?: string } | null)?.url);
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of windows) {
				if (new URL(client.url).origin !== sw.location.origin) continue;
				await client.focus();
				if ('navigate' in client) await (client as WindowClient).navigate(target);
				return;
			}
			await sw.clients.openWindow(target);
		})()
	);
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
