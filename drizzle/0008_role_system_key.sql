-- Stabile Kennung für Rollen, die der Core für Module anlegt (`defaultRoleGrants`, #67 01a-07).
-- Modulrechte gehen nur noch an Rollen mit passender Kennung `default:<Name>`, nicht mehr an jede
-- gleichnamige Rolle (Rollen-Namens-Squatting). Bestehende Rollen, die schon Standardrechte bekommen
-- haben (Marker in `role_grant_applied`), erhalten die Kennung, damit sie unverändert weiterlaufen.
ALTER TABLE "role" ADD COLUMN IF NOT EXISTS "system_key" text;
--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_system_key_unique" UNIQUE("system_key");
--> statement-breakpoint
UPDATE "role" SET "system_key" = 'default:' || "name"
	WHERE "system_key" IS NULL AND "is_system" = false
		AND "name" IN (SELECT DISTINCT "role_name" FROM "role_grant_applied");
