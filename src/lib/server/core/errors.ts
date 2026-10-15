/** Einheitliche Fehlerklassen des Core. Werden vom API-Router und den Hooks auf HTTP abgebildet. */
export type CoreErrorCode =
	| 'bad_request'
	| 'validation_failed'
	| 'unauthenticated'
	| 'forbidden'
	| 'not_found'
	| 'method_not_allowed'
	| 'conflict'
	| 'rate_limited'
	| 'module_disabled'
	| 'payload_too_large'
	| 'unavailable'
	| 'internal_error';

const STATUS: Record<CoreErrorCode, number> = {
	bad_request: 400,
	validation_failed: 422,
	unauthenticated: 401,
	forbidden: 403,
	not_found: 404,
	method_not_allowed: 405,
	conflict: 409,
	rate_limited: 429,
	module_disabled: 404,
	payload_too_large: 413,
	unavailable: 503,
	internal_error: 500
};

export class CoreError extends Error {
	readonly code: CoreErrorCode;
	readonly status: number;
	readonly details?: unknown;

	constructor(code: CoreErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = 'CoreError';
		this.code = code;
		this.status = STATUS[code];
		this.details = details;
	}
}

export const errors = {
	badRequest: (m = 'Ungueltige Anfrage', d?: unknown) => new CoreError('bad_request', m, d),
	validation: (d: unknown, m = 'Validierung fehlgeschlagen') =>
		new CoreError('validation_failed', m, d),
	unauthenticated: (m = 'Authentifizierung erforderlich') => new CoreError('unauthenticated', m),
	forbidden: (m = 'Keine Berechtigung') => new CoreError('forbidden', m),
	notFound: (m = 'Nicht gefunden') => new CoreError('not_found', m),
	methodNotAllowed: (m = 'Methode nicht erlaubt') => new CoreError('method_not_allowed', m),
	conflict: (m = 'Konflikt') => new CoreError('conflict', m),
	rateLimited: (m = 'Zu viele Anfragen') => new CoreError('rate_limited', m),
	moduleDisabled: (id: string) => new CoreError('module_disabled', `Modul "${id}" ist nicht aktiv`),
	tooLarge: (m = 'Datei ist zu gross') => new CoreError('payload_too_large', m),
	unavailable: (m = 'Dienst nicht konfiguriert oder nicht erreichbar') =>
		new CoreError('unavailable', m)
};

export function isCoreError(e: unknown): e is CoreError {
	return e instanceof CoreError;
}
