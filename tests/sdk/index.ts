/**
 * Test-Schnittstelle `$testing` (Kalypzo Atrium, Phase 3): die einzige Stelle, über die **Modultests** Core-Interna
 * erreichen. Modultests (künftig im Module-Repo) importieren nur `$testing`, `$lib/sdk/*` und ihr eigenes Modul –
 * nie `$lib/server/*` oder `tests/helpers/*` direkt. Ändert sich der Core intern, wird nur diese Datei angepasst.
 *
 * Typischer Aufbau (siehe `.claude/rules/testing-and-verification.md`):
 * ```ts
 * import { useTestDatabase, registerCoreApi, registerModule, syncModules, bootstrapAdmin, adminContext,
 *   enableModule } from '$testing';
 * await useTestDatabase(); registerCoreApi(); registerModule(myModule); await syncModules();
 * const admin = await adminContext('admin@example.test', 'correct-horse-battery');
 * await enableModule(admin, 'my-module');
 * ```
 */
import { eq } from 'drizzle-orm';
import type { RequestContext } from '$lib/sdk/types';
import { contextForUser } from '$lib/server/core/auth/context';
import { bootstrapAdmin } from '$lib/server/core/auth/users';
import { getDb, schema } from '$lib/server/core/database/client';
import { handleApiRequest } from '$lib/server/core/api/router';
import { resetAllForTests } from '$lib/server/core/rate-limit';

// --- Datenbank und Testumgebung ---------------------------------------------------------------
export { useTestDatabase, isRealPostgres, pgTestUrl } from '../helpers/db';
export {
	fakeS3Calls,
	installFakeStorage,
	uninstallFakeStorage,
	fakeObjects,
	fakeFileRows
} from '../helpers/fake-storage';
export { settleMails } from '../helpers/settle';
export { moduleSql, migrateModuleTo, migrateModuleRest } from '../helpers/migrations';
export { confirmIfNeeded, optInToken } from '../helpers/registration-optin';

export * from './core';

// --- Core-Objekt und Module -------------------------------------------------------------------

// --- Konten, Rollen, API --------------------------------------------------------------------------

// --- Core-Dienste mit Test-Schaltern ----------------------------------------------------------
export { modulesDir, moduleIds } from '../../tools/modules-dir.js';

// --- Bequeme Helfer ---------------------------------------------------------------------------

/** Kontext eines Kontos über seine E-Mail-Adresse (wirft, wenn unbekannt) */
export async function contextForEmail(email: string): Promise<RequestContext> {
	const [u] = await getDb().select().from(schema.user).where(eq(schema.user.email, email));
	if (!u) throw new Error(`Kein Konto mit ${email}`);
	return (await contextForUser(u.id))!.ctx;
}

/** Erste*n Administrator*in anlegen (nach `syncModules`) und den Kontext liefern */
export async function adminContext(email: string, password: string): Promise<RequestContext> {
	await bootstrapAdmin(email, password);
	return contextForEmail(email);
}

/** Antwort eines API-Aufrufs: Status und JSON-Körper (`{ data }` bzw. `{ error }`) */
export interface ApiResult<T = unknown> {
	status: number;
	body: { data?: T; error?: { code: string; message?: string; details?: unknown } };
}

/**
 * REST-Aufruf gegen den zentralen Router (`/api/v1/<pfad>`) mit API-Key; setzt die Rate-Limits zurück.
 * `json` wird als Body gesendet; Antwort ohne JSON → `body = {}`.
 */
export async function apiCall<T = unknown>(
	key: string,
	method: string,
	path: string,
	json?: unknown
): Promise<ApiResult<T>> {
	resetAllForTests();
	const headers = new Headers({ authorization: `Bearer ${key}` });
	if (json !== undefined) headers.set('content-type', 'application/json');
	const url = new URL(`http://localhost:5173/api/v1${path}`);
	const res = await handleApiRequest({
		request: new Request(url, {
			method,
			headers,
			body: json === undefined ? undefined : JSON.stringify(json)
		}),
		url,
		ip: '127.0.0.1'
	});
	const text = await res.text();
	let body: ApiResult<T>['body'] = {};
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		// keine JSON-Antwort (z. B. PDF/CSV) – Körper bleibt leer
	}
	return { status: res.status, body };
}

/** Form-Actions der Profilseite (Core-Route) für modulübergreifende Tests (z. B. Mitglieder-Karte im Profil) */
export { actions as profileActions } from '../../src/routes/(internal)/profile/+page.server';
