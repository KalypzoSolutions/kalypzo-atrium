-- Benachrichtigungen (core.notifications): Kanalwahl je Person, Push-Geräte, Warteschlange für die Tageszusammenfassung.
CREATE TABLE IF NOT EXISTS "notification_pref" (
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"type_key" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"channel" text NOT NULL,
	"delivery" text DEFAULT 'immediate' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_pref_pk" PRIMARY KEY("user_id","type_key","scope"),
	CONSTRAINT "notification_pref_channel_check" CHECK ("channel" IN ('off', 'email', 'both', 'push')),
	CONSTRAINT "notification_pref_delivery_check" CHECK ("delivery" IN ('immediate', 'daily'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "push_subscription_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscription_user_idx" ON "push_subscription" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
	"type_key" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"channel" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link" text,
	"group_label" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_queue_channel_check" CHECK ("channel" IN ('email', 'both', 'push'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notification_queue_user_idx" ON "notification_queue" ("user_id", "created_at");
