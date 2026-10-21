/**
 * Generationszähler für den Cache von SMTP-Einstellungen und Transport (`mail.ts`, #24).
 * Bewusst ohne Importe, damit `settings/service.ts` die Invalidierung aufrufen kann, ohne einen
 * Importzyklus (mail → settings → mail) zu erzeugen. Muster: `storage/config-cache.ts`.
 */
let generation = 0;

/** Verwirft SMTP-Einstellungen und Transport (z. B. nach dem Speichern der Einstellungen). */
export function invalidateMailTransportCache(): void {
	generation++;
}

/** Aktuelle Generation; ändert sich bei jeder Invalidierung. */
export function mailTransportGeneration(): number {
	return generation;
}
