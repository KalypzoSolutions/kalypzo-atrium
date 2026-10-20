/**
 * Standard-Rate-Limits des API-Routers für die API-Übersicht.
 *
 * Spiegel der privaten Konstanten `DEFAULT_LIMIT` / `ANON_LIMIT` in `../router.ts`.
 * Beide Stellen müssen gleich bleiben: Ändert sich ein Wert im Router, hier mit anpassen.
 */

/** Angemeldete Aufrufer (Session oder API-Key) ohne eigenes `rateLimit` am Endpunkt */
export const DEFAULT_RATE_LIMIT = { limit: 120, windowSec: 60 } as const;

/** Anonyme Aufrufer (öffentliche Endpunkte) ohne eigenes `rateLimit` am Endpunkt */
export const ANON_RATE_LIMIT = { limit: 30, windowSec: 60 } as const;
