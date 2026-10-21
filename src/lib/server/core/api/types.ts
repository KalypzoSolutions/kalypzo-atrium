import type { z } from 'zod';
import type { RequestContext } from '$lib/sdk/types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiHandlerArgs<P, Q, B> {
	ctx: RequestContext;
	params: P;
	query: Q;
	body: B;
	request: Request;
	/** Nur bei `multipart`: hochgeladene Dateien (Textfelder stehen validiert in `body`) */
	files?: File[];
}

/** Rückgabe eines Handlers: Daten (=> `{ data }`) oder eine fertige Response. */
export type ApiHandlerResult = unknown | Response;

export interface ApiEndpoint<P = Record<string, string>, Q = Record<string, unknown>, B = unknown> {
	method: HttpMethod;
	/** Pfad relativ zu `/api/v1`, z. B. `/users/:id`. Modul-Endpunkte liegen unter `/modules/<id>`. */
	path: string;
	summary: string;
	description?: string;
	tags?: string[];
	/**
	 * Erforderliche Berechtigung. `null` nur für bewusst öffentliche Endpunkte (z. B. Health);
	 * Endpunkte, die nur eine angemeldete Identität brauchen, setzen `authenticated`.
	 */
	permission: string | null;
	/**
	 * Bewusst öffentlicher, anonym erreichbarer Modul-Endpunkt (Opt-in). Nur mit `permission: null`,
	 * `rateLimit` ist Pflicht, Methoden nur GET/POST, POST braucht ein `body`-Schema.
	 */
	public?: boolean;
	/** Nur Anmeldung nötig (z. B. eigenes Profil) */
	authenticated?: boolean;
	/** Nur mit Session erreichbar, nie per API-Key (z. B. API-Key-Verwaltung selbst) */
	sessionOnly?: boolean;
	params?: z.ZodType<P>;
	query?: z.ZodType<Q>;
	body?: z.ZodType<B>;
	/** Schema der `data`-Nutzlast (für OpenAPI) */
	response?: z.ZodType;
	rateLimit?: { limit: number; windowSec: number };
	/**
	 * Nur für `public: true` + POST: `multipart/form-data` statt JSON. Textfelder werden mit `body`
	 * validiert, Dateien landen in `files`. `maxBytes` = Obergrenze des gesamten Requests (max. 30 MB).
	 */
	multipart?: { maxBytes: number; maxFiles?: number };
	handler: (args: ApiHandlerArgs<P, Q, B>) => Promise<ApiHandlerResult> | ApiHandlerResult;
}

/** Registrierter Endpunkt inklusive Modulzuordnung (vom Registry gesetzt). */
/**
 * Endpunkt mit beliebigen Parametern/Query/Body – Typ für Endpunkt-Listen der Module
 * (`export const xEndpoints: AnyApiEndpoint[] = [defineEndpoint({...}), …]`), ohne Doppel-Cast.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyApiEndpoint = ApiEndpoint<any, any, any>;

export interface RegisteredEndpoint extends ApiEndpoint<never, never, never> {
	moduleId: string;
	fullPath: string;
	segments: string[];
}
