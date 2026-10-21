import { randomUUID } from 'node:crypto';

/** Erlaubte Request-IDs vom Client (z. B. Proxy oder Website): nur Buchstaben, Ziffern, Bindestrich. */
const REQUEST_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Übernimmt `x-request-id` nur, wenn sie dem sicheren Muster entspricht; sonst eine neue UUID.
 * Die ID landet in Antwort-Headern, `api_log`, Audit und Konsolen-Log – Steuerzeichen oder
 * Zeilenumbrüche würden Log-Fälschung erlauben (#72, 06-15).
 */
export function requestIdFrom(headers: Headers): string {
	const raw = headers.get('x-request-id');
	return raw && REQUEST_ID_RE.test(raw) ? raw : randomUUID();
}
