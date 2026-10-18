import { allDefinitions } from '../modules/registry';
import type { ApiEndpoint, HttpMethod, RegisteredEndpoint } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyEndpoint = ApiEndpoint<any, any, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Typisierte Helfer-Funktion zur Definition eines Endpunkts (Inferenz für Handler-Argumente). */
export function defineEndpoint<
	P = Record<string, string>,
	Q = Record<string, never>,
	B = undefined
>(e: ApiEndpoint<P, Q, B>): ApiEndpoint<P, Q, B> {
	return e;
}

const coreEndpoints: AnyEndpoint[] = [];

/** Registriert Core-Endpunkte (nur aus dem Core selbst aufzurufen). */
export function registerCoreEndpoints(list: AnyEndpoint[]): void {
	coreEndpoints.push(...list);
}

export function resetCoreEndpointsForTests(): void {
	coreEndpoints.length = 0;
}

function normalize(path: string): string[] {
	return path.split('/').filter(Boolean);
}

function toRegistered(e: AnyEndpoint, moduleId: string, prefix: string): RegisteredEndpoint {
	const fullPath = prefix + (e.path.startsWith('/') ? e.path : `/${e.path}`);
	return { ...e, moduleId, fullPath, segments: normalize(fullPath) } as RegisteredEndpoint;
}

/**
 * Obergrenze für `multipart.maxBytes` (gesamter Request), z. B. mehrere Belege im Kosten-Link.
 * `BODY_SIZE_LIMIT` des Servers (Dockerfile) und ein Proxy-Limit müssen mindestens so groß sein.
 */
export const MAX_MULTIPART_BYTES = 30 * 1024 * 1024;

function assertMultipart(where: string, e: AnyEndpoint): void {
	if (e.multipart === undefined) return;
	if (e.public !== true || e.permission !== null || e.method !== 'POST') {
		throw new Error(`${where}: multipart ist nur für öffentliche POST-Endpunkte erlaubt`);
	}
	if (!e.body) throw new Error(`${where}: multipart braucht ein body-Schema für die Textfelder`);
	const { maxBytes, maxFiles } = e.multipart;
	if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_MULTIPART_BYTES) {
		throw new Error(`${where}: multipart.maxBytes muss zwischen 1 und 30 MB liegen`);
	}
	if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles < 0 || maxFiles > 10)) {
		throw new Error(`${where}: multipart.maxFiles muss zwischen 0 und 10 liegen`);
	}
}

function assertModuleEndpoint(moduleId: string, e: AnyEndpoint): void {
	const where = `Modul ${moduleId}: Endpunkt ${e.method} ${e.path}`;
	assertMultipart(where, e);
	if (e.public === true && e.permission !== null) {
		throw new Error(`${where} ist öffentlich markiert, verlangt aber eine Berechtigung`);
	}
	if (e.permission !== null) return;
	if (e.public !== true) {
		throw new Error(`${where} darf nicht öffentlich sein (nur mit public: true erlaubt)`);
	}
	if (!e.rateLimit) throw new Error(`${where}: öffentliche Endpunkte brauchen ein rateLimit`);
	if (e.method !== 'GET' && e.method !== 'POST') {
		throw new Error(`${where}: öffentliche Endpunkte erlauben nur GET und POST`);
	}
	if (e.method === 'POST' && !e.body) {
		throw new Error(`${where}: öffentliche POST-Endpunkte brauchen ein body-Schema`);
	}
}

/** Alle Endpunkte: Core + Endpunkte registrierter Module (unter /modules/<id>). */
export function allEndpoints(): RegisteredEndpoint[] {
	const out = coreEndpoints.map((e) => toRegistered(e, 'core', ''));
	for (const m of allDefinitions()) {
		for (const e of m.endpoints ?? []) {
			assertModuleEndpoint(m.manifest.id, e);
			out.push(toRegistered(e, m.manifest.id, `/modules/${m.manifest.id}`));
		}
	}
	return out;
}

export interface Match {
	endpoint: RegisteredEndpoint;
	params: Record<string, string>;
}

export function matchEndpoint(
	method: string,
	pathname: string
): { match?: Match; pathExists: boolean } {
	const segs = normalize(pathname);
	let pathExists = false;
	for (const e of allEndpoints()) {
		if (e.segments.length !== segs.length) continue;
		const params: Record<string, string> = {};
		let ok = true;
		for (let i = 0; i < segs.length; i++) {
			const pat = e.segments[i] as string;
			const seg = segs[i] as string;
			if (pat.startsWith(':')) {
				try {
					params[pat.slice(1)] = decodeURIComponent(seg);
				} catch {
					ok = false;
					break;
				}
			} else if (pat !== seg) {
				ok = false;
				break;
			}
		}
		if (!ok) continue;
		pathExists = true;
		if (e.method === (method.toUpperCase() as HttpMethod))
			return { match: { endpoint: e, params }, pathExists };
	}
	return { pathExists };
}
