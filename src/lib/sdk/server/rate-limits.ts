/**
 * Gemeinsame Rate-Limits für Modul-Endpunkte.
 *
 * Das Standardlimit des Routers (120/60 s) gilt je Benutzer*in bzw. API-Key **und Endpunktmuster** –
 * bei Bildern also für alle Bilder aller Galerien zusammen. Eine Galerie mit 500 Fotos lädt beim
 * Durchscrollen Hunderte Vorschaubilder; deshalb bekommen alle Bild-/Thumbnail-Endpunkte (#23) ein
 * eigenes, großzügiges Kontingent.
 */
export const IMAGE_RATE_LIMIT = { limit: 1200, windowSec: 60 } as const;
