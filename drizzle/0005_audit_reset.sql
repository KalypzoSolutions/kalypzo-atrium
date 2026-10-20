-- Reset durch Administrator*innen: DELETE auf audit_log nur, wenn die Reset-Transaktion
-- `SET LOCAL app.audit_reset = 'on'` gesetzt hat. UPDATE und TRUNCATE bleiben verboten.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' AND current_setting('app.audit_reset', true) = 'on' THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'audit_log ist unveraenderlich (%).', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
