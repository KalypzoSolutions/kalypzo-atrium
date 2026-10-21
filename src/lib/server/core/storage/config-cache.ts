/**
 * Generationszähler für den Cache der Storage-Konfiguration (`loadConfig` in `./index.ts`).
 * Bewusst ohne Importe, damit `settings/service.ts` die Invalidierung aufrufen kann, ohne einen
 * Importzyklus (storage → settings → storage) zu erzeugen.
 */
let generation = 0;

/** Verwirft die zwischengespeicherte Storage-Konfiguration (z. B. nach dem Speichern der Einstellungen). */
export function invalidateStorageConfigCache(): void {
	generation++;
}

/** Aktuelle Generation; ändert sich bei jeder Invalidierung. */
export function storageConfigGeneration(): number {
	return generation;
}
