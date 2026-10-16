CREATE TABLE IF NOT EXISTS "job_run" (
	"key" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone NOT NULL,
	"last_finished_at" timestamp with time zone,
	"last_status" text,
	"last_message" text
);
