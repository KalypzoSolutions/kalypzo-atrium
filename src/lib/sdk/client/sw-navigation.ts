import { goto } from '$app/navigation';

/**
 * Empfängt Navigationswünsche des Service Workers (Klick auf eine Push-Benachrichtigung) und öffnet die Zielseite
 * im **laufenden** App-Fenster per SvelteKit-Navigation – auch in der installierten App (PWA).
 *
 * - `ep:navigate` (Fenster ist offen): Ziel öffnen und dem Service Worker per Port bestätigen.
 * - `ep:pending-navigation` erfragen – beim Start **und** jedes Mal, wenn die App wieder sichtbar wird: Ziel eines
 *   Klicks, das nicht per Nachricht ankam. iOS hält Apps im Hintergrund angehalten (Nachricht geht verloren) und
 *   öffnet sie beim Kaltstart teils auf der Startseite statt auf der Zieladresse.
 *
 * Rückgabe: Aufräumfunktion.
 */
export function initServiceWorkerNavigation(): () => void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
	const container = navigator.serviceWorker;
	/** Zuletzt geöffnetes Ziel – verhindert doppelte Navigation (Nachricht + Abholung) */
	let last: { url: string; at: number } | null = null;

	const open = async (url: string, replaceState = false) => {
		if (last && last.url === url && Date.now() - last.at < 60_000) return;
		last = { url, at: Date.now() };
		if (url === location.pathname + location.search + location.hash) return;
		try {
			await goto(url, { replaceState });
		} catch {
			location.assign(url);
		}
	};

	const onMessage = (event: MessageEvent) => {
		const data = event.data as { type?: string; url?: unknown } | null;
		if (data?.type !== 'ep:navigate') return;
		const url = appPath(data.url);
		const port = event.ports[0];
		port?.postMessage({ ok: url !== null });
		if (url) void open(url);
	};
	container.addEventListener('message', onMessage);

	const checkPending = (initial = false) => {
		if (document.visibilityState !== 'visible') return;
		void container.ready
			.then((reg) => {
				const worker = container.controller ?? reg.active;
				if (!worker) return;
				const channel = new MessageChannel();
				channel.port1.onmessage = (e) => {
					const url = appPath((e.data as { url?: unknown } | null)?.url);
					if (url) void open(url, initial === true);
					channel.port1.close();
				};
				worker.postMessage({ type: 'ep:pending-navigation' }, [channel.port2]);
			})
			.catch(() => undefined);
	};
	const onVisible = () => checkPending();
	checkPending(true);
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('pageshow', onVisible);
	window.addEventListener('focus', onVisible);

	return () => {
		container.removeEventListener('message', onMessage);
		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('pageshow', onVisible);
		window.removeEventListener('focus', onVisible);
	};
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
