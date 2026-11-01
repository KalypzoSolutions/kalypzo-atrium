CREATE TABLE IF NOT EXISTS notes (
	id text PRIMARY KEY,
	title text NOT NULL,
	due_on date,
	owner_id text,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_shares (
	note_id text NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
	principal_type text NOT NULL CHECK (principal_type IN ('everyone', 'group', 'role', 'user', 'member')),
	principal_id text NOT NULL,
	level text NOT NULL CHECK (level IN ('read', 'edit')),
	created_by text,
	created_at timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (note_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS note_shares_principal_idx ON note_shares (principal_type, principal_id);
