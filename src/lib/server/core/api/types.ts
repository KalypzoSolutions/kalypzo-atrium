import type { z } from 'zod';
import type { RequestContext } from '$lib/sdk/types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiHandlerArgs<P, Q, B> {
	ctx: RequestContext;
	params: P;
	query: Q;
	body: B;
	request: Request;
}

/** Rueckgabe eines Handlers: Daten (=> `{ data }`) oder eine fertige Response. */
export type ApiHandlerResult = unknown | Response;

export interface ApiEndpoint<P = Record<string, string>, Q = Record<string, unknown>, B = unknown> {
	method: HttpMethod;
	/** Pfad relativ zu `/api/v1`, z. B. `/users/:id`. Modul-Endpunkte liegen unter `/modules/<id>`. */
	path: string;
	summary: string;
	description?: string;
	tags?: string[];
	/**
	 * Erforderliche Berechtigung. `null` nur fuer bewusst oeffentliche Endpunkte (z. B. Health);
	 * Endpunkte, die nur eine angemeldete Identitaet brauchen, setzen `authenticated`.
	 */
	permission: string | null;
	/**
	 * Bewusst oeffentlicher, anonym erreichbarer Modul-Endpunkt (Opt-in). Nur mit `permission: null`,
	 * `rateLimit` ist Pflicht, Methoden nur GET/POST, POST braucht ein `body`-Schema.
	 */
	public?: boolean;
	/** Nur Anmeldung noetig (z. B. eigenes Profil) */
	authenticated?: boolean;
	/** Nur mit Session erreichbar, nie per API-Key (z. B. API-Key-Verwaltung selbst) */
	sessionOnly?: boolean;
	params?: z.ZodType<P>;
	query?: z.ZodType<Q>;
	body?: z.ZodType<B>;
	/** Schema der `data`-Nutzlast (fuer OpenAPI) */
	response?: z.ZodType;
	rateLimit?: { limit: number; windowSec: number };
	handler: (args: ApiHandlerArgs<P, Q, B>) => Promise<ApiHandlerResult> | ApiHandlerResult;
}

/** Registrierter Endpunkt inklusive Modulzuordnung (vom Registry gesetzt). */
export interface RegisteredEndpoint extends ApiEndpoint<never, never, never> {
	moduleId: string;
	fullPath: string;
	segments: string[];
}
