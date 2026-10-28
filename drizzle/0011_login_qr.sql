-- Anmeldung per QR-Code: Desktop zeigt einen Code, ein angemeldetes Handy bestätigt. Token im QR und Geheimnis des
-- anzeigenden Browsers (httpOnly-Cookie) nur als SHA-256; Anfragen leben wenige Minuten und werden aufgeräumt.
CREATE TABLE IF NOT EXISTS "login_qr_request" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"secret_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"user_id" text REFERENCES "user"("id") ON DELETE CASCADE,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scanned_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	CONSTRAINT "login_qr_request_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "login_qr_request_status_check" CHECK ("status" IN ('pending', 'approved', 'denied', 'consumed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_qr_request_expires_idx" ON "login_qr_request" ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_qr_request_user_idx" ON "login_qr_request" ("user_id");
