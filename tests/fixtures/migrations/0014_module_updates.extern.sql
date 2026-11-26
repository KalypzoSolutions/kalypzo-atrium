-- Kalypzo Atrium: bessere Update-Logik für Module. Kanal je Modul (Versions-Tags oder Branch), ignorierte Version
-- und der letzte Prüfstand je Modul. Alles additiv; Bestand folgt wie bisher dem Branch.
ALTER TABLE "module_install" ADD COLUMN IF NOT EXISTS "channel" text DEFAULT 'branch' NOT NULL;
--> statement-breakpoint
ALTER TABLE "module_install" DROP CONSTRAINT IF EXISTS "module_install_channel_check";
--> statement-breakpoint
ALTER TABLE "module_install" ADD CONSTRAINT "module_install_channel_check" CHECK ("channel" IN ('release', 'branch'));
--> statement-breakpoint
ALTER TABLE "module_install" ADD COLUMN IF NOT EXISTS "ignored_update" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_update_check" (
	"id" text PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"result" text NOT NULL,
	"latest_version" text,
	"latest_ref" text,
	"latest_commit" text,
	"latest_content_hash" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notified_key" text,
	CONSTRAINT "module_update_check_result_check" CHECK ("result" IN ('ok', 'error', 'no-source'))
);
