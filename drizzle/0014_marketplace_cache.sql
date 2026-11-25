-- Modul-Marktplatz: letzte gültige Fassung des öffentlichen Index je URL (Rückfall, wenn die Website nicht
-- erreichbar ist). Kein Personenbezug; nie in der Datensicherung, der Reset-Bereich „Einstellungen“ leert sie.
CREATE TABLE IF NOT EXISTS "marketplace_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"etag" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_error" text
);
