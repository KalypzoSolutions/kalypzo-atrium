-- Benutzerverwaltung: letzte Anmeldung je Konto, „Als Person handeln“ (Impersonation) mit Kennzeichnung im Audit,
-- Indizes für die Statistik je Person. Alles additiv.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;
--> statement-breakpoint
-- Von der Verwaltung gesetztes Passwort: beim nächsten Besuch selbst ändern (nur über Profil → Sicherheit löschbar)
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "must_change_password" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "user" u SET "last_login_at" = l."at"
FROM (
	SELECT "actor_id", max("created_at") AS "at"
	FROM "audit_log"
	WHERE "action" = 'core.auth.login' AND "actor_id" IS NOT NULL
	GROUP BY "actor_id"
) l
WHERE l."actor_id" = u."id" AND u."last_login_at" IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_impersonation" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text REFERENCES "session"("id") ON DELETE SET NULL,
	"admin_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"target_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"ip" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	CONSTRAINT "user_impersonation_end_reason_check" CHECK ("end_reason" IS NULL OR "end_reason" IN ('stopped', 'expired', 'revoked'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_impersonation_session_idx" ON "user_impersonation" ("session_id") WHERE "ended_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_impersonation_target_idx" ON "user_impersonation" ("target_user_id", "started_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_impersonation_admin_idx" ON "user_impersonation" ("admin_user_id");
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "impersonator_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_impersonator_idx" ON "audit_log" ("impersonator_id") WHERE "impersonator_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_log_actor_idx" ON "api_log" ("actor_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_created_by_idx" ON "file" ("created_by");
