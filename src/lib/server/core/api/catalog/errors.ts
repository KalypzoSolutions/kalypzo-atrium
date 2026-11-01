import { t } from '$lib/i18n';
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
		add(400, 'bad_request', t('api.docs.notJson'));
	}
	if (e.multipart && mutating) {
		add(400, 'bad_request', t('api.docs.notMultipart'));
		add(400, 'bad_request', t('api.docs.noContentLength'));
		add(400, 'bad_request', t('api.docs.invalidForm', { count: e.multipart.maxFiles ?? 1 }));
	} else if (e.body) {
		add(400, 'bad_request', t('api.docs.invalidJson'));
	}

	// 401 – Authentifizierung (ein Authorization-Header kann bei jedem Endpunkt gesendet werden)
	if (needsIdentity) add(401, 'unauthenticated', t('api.docs.noLogin'));
	add(401, 'unauthenticated', t('api.docs.invalidAuthHeader'));
	add(401, 'unauthenticated', t('api.docs.invalidApiKey'));

	// 403 – CSRF, Session-Pflicht, Berechtigung
	if (mutating) add(403, 'forbidden', t('api.docs.foreignOrigin'));
	if (needsIdentity && e.sessionOnly) {
		add(403, 'forbidden', t('api.docs.sessionOnly'));
	}
	if (e.permission !== null)
		add(403, 'forbidden', t('api.docs.missingPermission', { permission: e.permission }));

	// 404 – Objekt bzw. Modul
	if (e.segments.some((s) => s.startsWith(':'))) {
		add(404, 'not_found', t('api.docs.objectNotFound'));
	}
	if (e.moduleId !== 'core')
		add(404, 'module_disabled', t('api.docs.moduleDisabled', { id: e.moduleId }));

	// 413 – Größe
	if (e.multipart && mutating) {
		add(
			413,
			'payload_too_large',
			t('api.docs.requestTooLarge', { mb: formatMb(e.multipart.maxBytes) })
		);
	} else if (e.body) {
		add(413, 'payload_too_large', t('api.docs.bodyTooLarge', { mb: JSON_BODY_LIMIT_MB }));
	}

	// 422 – Schema-Validierung
	if (e.params) add(422, 'validation_failed', t('api.docs.invalidParams'));
	if (e.query) add(422, 'validation_failed', t('api.docs.invalidQuery'));
	if (e.body)
		add(
			422,
			'validation_failed',
			e.multipart ? t('api.docs.invalidFields') : t('api.docs.invalidBody')
		);

	// 429, 500 – immer
	add(429, 'rate_limited', t('api.docs.rateLimited'));
	add(500, 'internal_error', t('api.docs.internalError'));

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
