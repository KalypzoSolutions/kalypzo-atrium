-- Einzelne Berechtigungen direkt am Benutzer (zusätzlich zu den Rollen).
CREATE TABLE IF NOT EXISTS "user_permission" (
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"permission_key" text NOT NULL REFERENCES "permission"("key") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permission_user_id_permission_key_pk" PRIMARY KEY("user_id","permission_key")
);
