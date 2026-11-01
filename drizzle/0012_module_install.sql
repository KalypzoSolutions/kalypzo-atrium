-- Kalypzo Atrium: Module aus Quellen (GitHub/ZIP) installieren. Wunschzustand je Modul und Verlauf der Installationen.
CREATE TABLE IF NOT EXISTS "module_install" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"source_type" text NOT NULL,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commit" text,
	"content_hash" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"installed_by" text,
	CONSTRAINT "module_install_source_type_check" CHECK ("source_type" IN ('github', 'upload', 'builtin'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "module_install_event" (
	"id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"action" text NOT NULL,
	"from_version" text,
	"to_version" text,
	"source_type" text,
	"source" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"commit" text,
	"content_hash" text,
	"status" text NOT NULL,
	"detail" text,
	"actor_id" text,
	"plan_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "module_install_event_status_check" CHECK ("status" IN ('requested', 'done', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_install_event_created_idx" ON "module_install_event" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "module_install_event_plan_idx" ON "module_install_event" ("plan_id");
