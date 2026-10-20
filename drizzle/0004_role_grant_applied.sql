CREATE TABLE IF NOT EXISTS "role_grant_applied" (
	"module_id" text NOT NULL,
	"role_name" text NOT NULL,
	"permission_key" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grant_applied_pk" PRIMARY KEY("module_id","role_name","permission_key")
);
