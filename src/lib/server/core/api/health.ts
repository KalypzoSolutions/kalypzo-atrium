import { t } from '$lib/i18n';
import { sql } from 'drizzle-orm';
import { getDb } from '../database/client';
import { errors } from '../errors';

/** Höchstdauer der Datenbankprüfung im Health-Check */
export const HEALTH_DB_TIMEOUT_MS = 2000;

let probe: () => Promise<unknown> = () => getDb().execute(sql`SELECT 1`);

/** Nur für Tests: eigene Datenbankprüfung (z. B. hängend oder fehlerhaft) */
export function setHealthProbeForTests(fn: (() => Promise<unknown>) | undefined): void {
	probe = fn ?? (() => getDb().execute(sql`SELECT 1`));
}

/**
 * Health-Check für Container/Orchestrierung: `SELECT 1` mit kurzem Timeout. Bei Fehler oder
 * Zeitüberschreitung 503 (ohne Details zur Ursache). Wird nicht im `api_log` protokolliert.
 */
export async function healthCheck(): Promise<{ status: 'ok'; database: 'ok' }> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			probe(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error('Zeitüberschreitung')), HEALTH_DB_TIMEOUT_MS);
			})
		]);
	} catch (e) {
		console.error('[health] Datenbank nicht erreichbar:', e instanceof Error ? e.message : e);
		throw errors.unavailable(t('api.health.databaseUnavailable'));
	} finally {
		if (timer) clearTimeout(timer);
	}
	return { status: 'ok', database: 'ok' };
}
