import type { ApiErrorInfo } from '$lib/api-docs/types';
import type { RegisteredEndpoint } from '../types';

/** Obergrenze für JSON-Bodies im Router (`MAX_BODY_BYTES` in `router.ts`). */
const JSON_BODY_LIMIT_MB = 1;

function formatMb(bytes: number): string {
	return String(Math.floor(bytes / (1024 * 1024)));
}

/**
 * Leitet die Fehlerantworten ab, die der API-Router (`router.ts`) für diesen Endpunkt liefern
 * kann – nur generische Router-Fehler, keine fachlichen Fehler des Handlers (außer dem
 * typischen 404 bei Pfadparametern). Sortiert nach Status, gleiche Status+Code zusammengefasst.
 */
export function deriveErrors(e: RegisteredEndpoint): ApiErrorInfo[] {
	const list: ApiErrorInfo[] = [];
	const add = (status: number, code: string, when: string) => list.push({ status, code, when });

	const mutating = e.method !== 'GET';
	const needsIdentity = e.permission !== null || e.authenticated === true;

	// 400 – Content-Type, JSON, Formulardaten
	if (e.public && mutating && !e.multipart) {
		add(400, 'bad_request', 'Content-Type ist nicht application/json');
	}
	if (e.multipart && mutating) {
		add(400, 'bad_request', 'Content-Type ist nicht multipart/form-data');
		add(400, 'bad_request', 'Content-Length fehlt');
		add(
			400,
			'bad_request',
			`Ungültige Formulardaten, doppeltes Feld oder mehr als ${e.multipart.maxFiles ?? 1} Datei(en)`
		);
	} else if (e.body) {
		add(400, 'bad_request', 'Body ist kein gültiges JSON');
	}

	// 401 – Authentifizierung (ein Authorization-Header kann bei jedem Endpunkt gesendet werden)
	if (needsIdentity) add(401, 'unauthenticated', 'Keine Anmeldung (weder Session noch API-Key)');
	add(401, 'unauthenticated', 'Authorization-Header ungültig (erwartet: Bearer <API-Key>)');
	add(401, 'unauthenticated', 'API-Key ungültig, abgelaufen oder widerrufen');

	// 403 – CSRF, Session-Pflicht, Berechtigung
	if (mutating) add(403, 'forbidden', 'Anfrage mit Session-Cookie von fremder Origin');
	if (needsIdentity && e.sessionOnly) {
		add(403, 'forbidden', 'Aufruf per API-Key (nur mit Session erreichbar)');
	}
	if (e.permission !== null) add(403, 'forbidden', `Berechtigung ${e.permission} fehlt`);

	// 404 – Objekt bzw. Modul
	if (e.segments.some((s) => s.startsWith(':'))) {
		add(404, 'not_found', 'Objekt nicht gefunden oder nicht sichtbar');
	}
	if (e.moduleId !== 'core') add(404, 'module_disabled', `Modul ${e.moduleId} ist nicht aktiv`);

	// 413 – Größe
	if (e.multipart && mutating) {
		add(413, 'payload_too_large', `Anfrage größer als ${formatMb(e.multipart.maxBytes)} MB`);
	} else if (e.body) {
		add(413, 'payload_too_large', `Body größer als ${JSON_BODY_LIMIT_MB} MB`);
	}

	// 422 – Schema-Validierung
	if (e.params) add(422, 'validation_failed', 'Pfadparameter ungültig');
	if (e.query) add(422, 'validation_failed', 'Query-Parameter ungültig');
	if (e.body)
		add(422, 'validation_failed', e.multipart ? 'Formularfelder ungültig' : 'Body ungültig');

	// 429, 500 – immer
	add(429, 'rate_limited', 'Zu viele Anfragen (Header Retry-After beachten)');
	add(500, 'internal_error', 'Unerwarteter Serverfehler, Request-ID angeben');

	// Gleiche Status+Code zusammenfassen, Reihenfolge des ersten Auftretens behalten
	const merged = new Map<string, ApiErrorInfo>();
	for (const item of list) {
		const key = `${item.status}:${item.code}`;
		const prev = merged.get(key);
		if (prev) prev.when = `${prev.when}; ${item.when}`;
		else merged.set(key, { ...item });
	}
	return [...merged.values()].sort((a, b) => a.status - b.status);
}
