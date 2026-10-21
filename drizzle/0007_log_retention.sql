-- Aufbewahrungsfristen für Protokolle (Core-Job `core.housekeeping`).
-- audit_log bleibt append-only. Ausnahmen nur innerhalb einer Transaktion mit
-- `SET LOCAL app.audit_retention = 'on'`: DELETE (Frist abgelaufen) und ein UPDATE, das
-- ausschließlich die IP auf NULL setzt. Reset (`app.audit_reset`, 0005) bleibt unverändert.
-- UPDATE ohne Flag, andere UPDATEs und TRUNCATE bleiben verboten.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF current_setting('app.audit_reset', true) = 'on'
			OR current_setting('app.audit_retention', true) = 'on' THEN
			RETURN OLD;
		END IF;
	ELSIF TG_OP = 'UPDATE' THEN
		IF current_setting('app.audit_retention', true) = 'on'
			AND NEW.ip IS NULL
			AND (to_jsonb(NEW) - 'ip') = (to_jsonb(OLD) - 'ip') THEN
			RETURN NEW;
		END IF;
	END IF;
	RAISE EXCEPTION 'audit_log ist unveraenderlich (%).', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Verlauf je Objekt (`listAudit({ target | targets })`, sortiert nach Zeit)
CREATE INDEX IF NOT EXISTS "audit_log_target_idx" ON "audit_log" USING btree ("target", "created_at" DESC);
--> statement-breakpoint
-- Präfixfilter auf Aktionen (`action LIKE 'prefix%'`)
CREATE INDEX IF NOT EXISTS "audit_log_action_pattern_idx" ON "audit_log" USING btree ("action" text_pattern_ops);
--> statement-breakpoint
-- Bestand: Link-Tokens öffentlicher Modul-Endpunkte im Pfad maskieren
-- (`/api/v1/modules/<modul>/public/<art>/<token>…` → `…/<art>/:token…`)
UPDATE "api_log"
	SET "path" = regexp_replace("path", '^(/api/v1/modules/[^/]+/public/[^/]+/)[^/]+', '\1:token')
	WHERE "path" ~ '^/api/v1/modules/[^/]+/public/[^/]+/[^/]+' AND "path" !~ '^/api/v1/modules/[^/]+/public/[^/]+/:token(/|$)';
--> statement-breakpoint
-- Bestand: Health-Checks werden nicht mehr protokolliert
DELETE FROM "api_log" WHERE "path" = '/api/v1/health';
