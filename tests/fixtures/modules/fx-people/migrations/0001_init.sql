CREATE TABLE IF NOT EXISTS people (
	id text PRIMARY KEY,
	name text NOT NULL,
	user_id text,
	left_on date
);

CREATE TABLE IF NOT EXISTS teams (
	id text PRIMARY KEY,
	name text NOT NULL
);

CREATE TABLE IF NOT EXISTS team_people (
	team_id text NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
	person_id text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
	PRIMARY KEY (team_id, person_id)
);

CREATE INDEX IF NOT EXISTS team_people_person_idx ON team_people (person_id);
