CREATE TABLE IF NOT EXISTS items (
	id uuid PRIMARY KEY,
	name text NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
