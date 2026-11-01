/**
 * Web Push im Browser: Unterstützung erkennen, dieses Gerät an- und abmelden.
 *
 * iOS/iPadOS erlaubt Push nur für Web-Apps, die zum Home-Bildschirm hinzugefügt wurden (ab iOS 16.4), und
 * nur nach einem Tippen der Person – `enablePush` daher immer direkt aus einem Klick aufrufen.
 */
import { t } from '$lib/i18n';
import { apiFetch } from './index';
import type { PushDevice } from '$lib/sdk/types/notifications';

export type PushSupport =
	/** alles da */
	| 'supported'
	/** iPhone/iPad im Browser: erst „Zum Home-Bildschirm“ */
	| 'ios-install'
	/** kein HTTPS */
	| 'insecure'
	/** Browser kann kein Web Push */
	| 'unsupported';

function isIos(): boolean {
	const ua = navigator.userAgent;
	return (
		/iPad|iPhone|iPod/.test(ua) ||
		// iPadOS meldet sich als Mac mit Touch
		(ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
	);
}

/** Läuft die App als installierte Web-App (Home-Bildschirm)? */
export function isStandalone(): boolean {
	return (
		window.matchMedia?.('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

export function pushSupport(): PushSupport {
	if (typeof window === 'undefined') return 'unsupported';
	if (!window.isSecureContext) return 'insecure';
	const hasApi =
		'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
	if (isIos() && !isStandalone()) return 'ios-install';
	return hasApi ? 'supported' : 'unsupported';
}

/** Berechtigung des Browsers: `default` (noch nicht gefragt), `granted`, `denied` */
export function pushPermission(): NotificationPermission {
	return typeof Notification === 'undefined' ? 'denied' : Notification.permission;
}

async function registration(): Promise<ServiceWorkerRegistration> {
	// SvelteKit registriert `/service-worker.js` selbst; hier nur sicherstellen, dass er bereit ist
	const existing = await navigator.serviceWorker.getRegistration('/');
	if (!existing) await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
	return navigator.serviceWorker.ready;
}

/** Aktuelles Abo dieses Geräts (oder `null`) */
export async function currentSubscription(): Promise<PushSubscription | null> {
	if (pushSupport() !== 'supported') return null;
	const reg = await navigator.serviceWorker.getRegistration('/');
	return (await reg?.pushManager.getSubscription()) ?? null;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	const pad = '='.repeat((4 - (value.length % 4)) % 4);
	const raw = atob((value + pad).replace(/-/g, '+').replace(/_/g, '/'));
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** Kurzer Gerätename für die Geräteliste, z. B. „Chrome auf Android“ */
export function deviceLabel(): string {
	const ua = navigator.userAgent;
	const os = /Android/.test(ua)
		? 'Android'
		: isIos()
			? /iPad/.test(ua) || ua.includes('Macintosh')
				? 'iPad'
				: 'iPhone'
			: /Windows/.test(ua)
				? 'Windows'
				: /Mac OS X/.test(ua)
					? 'Mac'
					: /Linux/.test(ua)
						? 'Linux'
						: t('pwa.unknownSystem');
	const browser = /Edg\//.test(ua)
		? 'Edge'
		: /SamsungBrowser/.test(ua)
			? 'Samsung Internet'
			: /Firefox\//.test(ua)
				? 'Firefox'
				: /Chrome\//.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: 'Browser';
	return t('pwa.deviceLabel', { app: isStandalone() ? 'App' : browser, os });
}

export class PushPermissionError extends Error {}

/**
 * Push auf diesem Gerät aktivieren: Berechtigung erfragen, Abo anlegen, beim Server registrieren.
 * Wirft `PushPermissionError`, wenn die Person ablehnt bzw. abgelehnt hat.
 */
export async function enablePush(): Promise<PushDevice> {
	if (pushSupport() !== 'supported') throw new Error(t('pwa.pushUnsupported'));
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		throw new PushPermissionError(t('pwa.permissionDenied'));
	}
	const { publicKey } = await apiFetch<{ publicKey: string }>('/notifications/push/key');
	const reg = await registration();
	let sub = await reg.pushManager.getSubscription();
	const key = base64UrlToBytes(publicKey);
	// Abo mit altem Schlüssel (z. B. nach Schlüsselwechsel) ersetzen
	const current = sub?.options.applicationServerKey;
	if (sub && current && !sameBytes(new Uint8Array(current), key)) {
		await sub.unsubscribe();
		sub = null;
	}
	sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
	const json = sub.toJSON();
	return apiFetch<PushDevice>('/notifications/push/subscriptions', {
		method: 'POST',
		body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label: deviceLabel() })
	});
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Push auf diesem Gerät abschalten (Abo im Browser und beim Server entfernen) */
export async function disablePush(): Promise<void> {
	const sub = await currentSubscription();
	if (!sub) return;
	const endpoint = sub.endpoint;
	await sub.unsubscribe();
	await apiFetch('/notifications/push/subscriptions/remove', {
		method: 'POST',
		body: JSON.stringify({ endpoint })
	}).catch(() => undefined);
}
