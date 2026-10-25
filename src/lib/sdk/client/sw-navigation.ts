import { goto } from '$app/navigation';

/**
 * Empfängt Navigationswünsche des Service Workers (Klick auf eine Push-Benachrichtigung) und öffnet die Zielseite
 * im **laufenden** App-Fenster per SvelteKit-Navigation – auch in der installierten App (PWA).
 *
 * - `ep:navigate` (Fenster ist offen): Ziel öffnen und dem Service Worker per Port bestätigen.
 * - Beim Start `ep:pending-navigation` erfragen: Ziel eines Klicks, falls die App beim Kaltstart auf der
 *   Startseite statt auf der Zieladresse gelandet ist (v. a. iOS).
 *
 * Rückgabe: Aufräumfunktion.
 */
export function initServiceWorkerNavigation(): () => void {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => undefined;
	const container = navigator.serviceWorker;

	const onMessage = (event: MessageEvent) => {
		const data = event.data as { type?: string; url?: unknown } | null;
		if (data?.type !== 'ep:navigate') return;
		const url = appPath(data.url);
		const port = event.ports[0];
		if (!url) {
			port?.postMessage({ ok: false });
			return;
		}
		port?.postMessage({ ok: true });
		void open(url);
	};
	container.addEventListener('message', onMessage);

	void container.ready
		.then((reg) => {
			const worker = container.controller ?? reg.active;
			if (!worker) return;
			const channel = new MessageChannel();
			channel.port1.onmessage = (e) => {
				const url = appPath((e.data as { url?: unknown } | null)?.url);
				if (url) void open(url, true);
				channel.port1.close();
			};
			worker.postMessage({ type: 'ep:pending-navigation' }, [channel.port2]);
		})
		.catch(() => undefined);

	return () => container.removeEventListener('message', onMessage);
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

async function open(url: string, replaceState = false): Promise<void> {
	if (url === location.pathname + location.search + location.hash) return;
	try {
		await goto(url, { replaceState });
	} catch {
		location.assign(url);
	}
}
