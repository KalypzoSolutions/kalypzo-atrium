/**
 * Client-SDK: darf im Browser verwendet werden. Enthält keine Secrets und keine
 * privilegierten Services – alle Operationen laufen über die REST-API.
 */
import type { ApiErrorBody } from '$lib/sdk/types';

export class ApiClientError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		readonly details?: unknown
	) {
		super(message);
	}
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	// FormData setzt den multipart-Header (inkl. Boundary) selbst.
	if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
		headers.set('content-type', 'application/json');
	}
	const res = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
		throw new ApiClientError(
			res.status,
			body?.error.code ?? 'unknown',
			body?.error.message ?? res.statusText,
			body?.error.details
		);
	}
	if (res.status === 204) return undefined as T;
	const json = (await res.json()) as { data: T };
	return json.data;
}

/** Permission-Check im UI. Nur Komfort – die Durchsetzung erfolgt immer serverseitig. */
export function can(permissions: readonly string[], key: string): boolean {
	return permissions.includes(key);
}
