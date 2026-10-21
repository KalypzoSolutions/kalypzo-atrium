/**
 * Nebenarbeit, die einen Ablauf nicht scheitern lassen darf (Bestätigungsmail, Audit, Rückschreiben,
 * Benachrichtigung), aber auch nie **still** scheitern soll (#72, 06-09).
 *
 * ```ts
 * const emailSent = (await bestEffort('actions.form.confirmation-mail', () => core.mail.send(…), {
 *   ctx, target: registrationId
 * })) !== undefined;
 * ```
 *
 * Geloggt wird mit `logError` (Beschreibung **ohne** SQL-Parameterwerte, siehe `db-errors.ts`) plus
 * `requestId`, Aktor-Typ und Objekt-ID – nie Personendaten. `label` ist ein fester Schlüssel
 * (`modul.vorgang`), keine Nutzereingaben.
 */
import { logError } from '$lib/server/core/db-errors';
import type { RequestContext } from '$lib/sdk/types';

export interface BestEffortInfo {
	/** Kontext des Aufrufs (für `requestId` und Aktor-Typ im Log) */
	ctx?: Pick<RequestContext, 'requestId' | 'actor'> | null;
	/** ID des betroffenen Objekts (keine Namen/E-Mails) */
	target?: string | null;
}

/** Protokolliert einen abgefangenen Fehler einer Nebenarbeit (für bestehende `catch`-Blöcke). */
export function logBestEffort(label: string, error: unknown, info: BestEffortInfo = {}): void {
	logError(`[best-effort] ${label} fehlgeschlagen`, error, {
		label,
		requestId: info.ctx?.requestId,
		actorType: info.ctx?.actor?.type,
		target: info.target ?? undefined
	});
}

/**
 * Führt `fn` aus; wirft nie. Ergebnis von `fn` oder `undefined` bei Fehler (der dann geloggt wird).
 */
export async function bestEffort<T>(
	label: string,
	fn: () => Promise<T> | T,
	info: BestEffortInfo = {}
): Promise<T | undefined> {
	try {
		return await fn();
	} catch (error) {
		logBestEffort(label, error, info);
		return undefined;
	}
}
