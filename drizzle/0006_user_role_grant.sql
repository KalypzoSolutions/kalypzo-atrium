-- Rollen, die ein Modul einem Benutzer verleiht (z. B. über Ämter). Getrennt von manuell
-- vergebenen Rollen (`user_role`); wirksam nur, solange das Modul aktiv ist.
CREATE TABLE IF NOT EXISTS "user_role_grant" (
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"role_id" text NOT NULL REFERENCES "role"("id") ON DELETE CASCADE,
	"module_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_grant_pk" PRIMARY KEY("user_id","role_id","module_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_role_grant_module_idx" ON "user_role_grant" ("module_id");
