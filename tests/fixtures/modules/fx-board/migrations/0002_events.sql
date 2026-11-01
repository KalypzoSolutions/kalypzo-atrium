-- Protokoll der Hooks (gelöschte Personen, Job-Läufe), damit Tests sie prüfen können
CREATE TABLE IF NOT EXISTS hook_log (
	id serial PRIMARY KEY,
	kind text NOT NULL,
	ref text NOT NULL,
	at timestamptz NOT NULL DEFAULT now()
);
