import { getRequestEvent } from '$app/server';

/**
 * Einzige Quelle für die Client-IP (Rate-Limits, Audit, Better Auth).
 *
 * Maßgeblich ist `event.getClientAddress()` von adapter-node (`ADDRESS_HEADER`/`XFF_DEPTH`, zählt
 * `X-Forwarded-For` von rechts). `hooks.server.ts` schreibt diese Adresse vor Better Auth in den
 * internen Header {@link CLIENT_IP_HEADER} und entfernt einen gleichnamigen Header des Clients;
 * Better Auth liest (`ipAddressHeaders`) nur diesen Header. Eigene `X-Forwarded-For`-Auswertung
 * gibt es nirgends.
 */
export const CLIENT_IP_HEADER = 'x-ep-client-ip';

/** `event.getClientAddress()` ohne Ausnahme (z. B. beim Prerendern) → `null`. */
export function clientAddress(event: { getClientAddress(): string }): string | null {
	try {
		return event.getClientAddress() || null;
	} catch {
		return null;
	}
}

/** Setzt den internen IP-Header (vorher immer entfernen: der Client darf ihn nicht vorgeben). */
export function applyClientIpHeader(headers: Headers, ip: string | null): void {
	headers.delete(CLIENT_IP_HEADER);
	if (ip) headers.set(CLIENT_IP_HEADER, ip);
}

/**
 * Client-IP für Code ohne direkten Zugriff auf das Event (Better-Auth-Hooks): zuerst die Adresse
 * des laufenden SvelteKit-Requests, sonst der serverseitig gesetzte Header (Tests, direkte Aufrufe).
 */
export function currentClientIp(headers?: Headers | null): string | null {
	try {
		const ip = getRequestEvent().getClientAddress();
		if (ip) return ip;
	} catch {
		/* kein Request-Kontext */
	}
	return headers?.get(CLIENT_IP_HEADER)?.trim() || null;
}

/** Kopie der Header mit gesetzter Client-IP (Form-Actions → `getAuth().api.*`). */
export function withClientIp(headers: Headers, ip: string | null): Headers {
	const copy = new Headers(headers);
	applyClientIpHeader(copy, ip);
	return copy;
}
