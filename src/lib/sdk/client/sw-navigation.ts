import { goto } from '$app/navigation';

/**
 * Empfängt Navigationswünsche des Service Workers (Klick auf eine Push-Benachrichtigung) und öffnet die Zielseite
 * im **laufenden** App-Fenster per SvelteKit-Navigation – auch in der installierten App (PWA).
 *
 * Drei Wege, weil iOS sich je nach Zustand anders verhält:
 * - `ep:navigate` als Nachricht an dieses Fenster (mit Bestätigung per Port), wenn der SW das Fenster findet.
 * - `ep:navigate` über den `BroadcastChannel` `ep-navigation`: iOS meldet dem SW die laufende App oft nicht.
 * - `ep:pending-navigation` erfragen – beim Start und nach jedem Sichtbarwerden **mehrmals kurz nacheinander**:
 *   iOS weckt die App, bevor der SW den Klick verarbeitet hat, und öffnet sie beim Kaltstart teils auf der Startseite.
 *
 * Rückgabe: Aufräumfunktion.
 */
export function initServiceWorkerNavigation(): () => void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
	const container = navigator.serviceWorker;
	/** Zuletzt geöffnetes Ziel – verhindert doppelte Navigation über mehrere Wege */
	let last: { url: string; at: number } | null = null;
	let timers: ReturnType<typeof setTimeout>[] = [];

	const worker = async (): Promise<ServiceWorker | null> => {
		const reg = await container.ready;
		return container.controller ?? reg.active ?? null;
	};

	const open = async (url: string, replaceState = false) => {
		if (last && last.url === url && Date.now() - last.at < 60_000) return;
		last = { url, at: Date.now() };
		void worker()
			.then((w) => w?.postMessage({ type: 'ep:pending-clear' }))
			.catch(() => undefined);
		if (url === location.pathname + location.search + location.hash) return;
		try {
			await goto(url, { replaceState });
		} catch {
			location.assign(url);
		}
	};

	const handleNavigate = (data: unknown, port?: MessagePort) => {
		const msg = data as { type?: string; url?: unknown } | null;
		if (msg?.type !== 'ep:navigate') return;
		const url = appPath(msg.url);
		port?.postMessage({ ok: url !== null });
		if (url) void open(url);
	};

	const onMessage = (event: MessageEvent) => handleNavigate(event.data, event.ports[0]);
	container.addEventListener('message', onMessage);

	let broadcast: BroadcastChannel | null = null;
	try {
		broadcast = new BroadcastChannel('ep-navigation');
		broadcast.onmessage = (event) => handleNavigate(event.data);
	} catch {
		broadcast = null;
	}

	const askPending = (replaceState: boolean) => {
		void worker()
			.then((w) => {
				if (!w) return;
				const channel = new MessageChannel();
				channel.port1.onmessage = (e) => {
					const url = appPath((e.data as { url?: unknown } | null)?.url);
					if (url) void open(url, replaceState);
					channel.port1.close();
				};
				w.postMessage({ type: 'ep:pending-navigation' }, [channel.port2]);
			})
			.catch(() => undefined);
	};

	/** Nach dem Sichtbarwerden mehrmals fragen: der Klick kommt beim SW evtl. erst nach dem Aufwachen an */
	const checkPending = (initial = false) => {
		if (document.visibilityState !== 'visible') return;
		for (const t of timers) clearTimeout(t);
		timers = [0, 400, 1200, 3000].map((ms) => setTimeout(() => askPending(initial), ms));
	};
	const onVisible = () => checkPending();
	checkPending(true);
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('pageshow', onVisible);
	window.addEventListener('focus', onVisible);

	return () => {
		for (const t of timers) clearTimeout(t);
		container.removeEventListener('message', onMessage);
		broadcast?.close();
		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('pageshow', onVisible);
		window.removeEventListener('focus', onVisible);
	};
}

/** Version des aktiven Service Workers (Build-Version) – zur Prüfung, ob ein Gerät die neue Fassung hat */
export async function serviceWorkerVersion(): Promise<string | null> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
	const reg = await navigator.serviceWorker.getRegistration('/');
	const w = navigator.serviceWorker.controller ?? reg?.active;
	if (!w) return null;
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		const timer = setTimeout(() => resolve(null), 2000);
		channel.port1.onmessage = (e) => {
			clearTimeout(timer);
			const v = (e.data as { version?: unknown } | null)?.version;
			resolve(typeof v === 'string' ? v : null);
		};
		w.postMessage({ type: 'ep:sw-version' }, [channel.port2]);
	});
}

/** Nur relative Pfade dieser App (wie im Service Worker) */
function appPath(value: unknown): string | null {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
	try {
		const url = new URL(value, location.origin);
		return url.origin === location.origin ? url.pathname + url.search + url.hash : null;
	} catch {
		return null;
	}
}
