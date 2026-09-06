-- One bounded aggregate and revision per verified Better Auth user.
CREATE TABLE workspace (
  owner_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision < 9007199254740991)
);
CREATE TABLE project (
  owner_id text NOT NULL REFERENCES workspace(owner_id) ON DELETE CASCADE,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  description text NOT NULL CHECK (length(description) <= 280),
  archived boolean NOT NULL,
  PRIMARY KEY(owner_id,id)
);
CREATE TABLE task (
  owner_id text NOT NULL,
  id text NOT NULL CHECK (length(id) BETWEEN 1 AND 128),
  project_id text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  description text NOT NULL CHECK (length(description) <= 500),
  status text NOT NULL CHECK (status IN ('todo','in_progress','done')),
  -- Canonical ISO strings preserve millisecond wire representation exactly.
  created_at text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY(owner_id,id),
  FOREIGN KEY(owner_id,project_id) REFERENCES project(owner_id,id) ON DELETE CASCADE
);
CREATE INDEX task_project_idx ON task(owner_id,project_id);
CREATE TABLE workspace_import_receipt (
  owner_id text NOT NULL REFERENCES workspace(owner_id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  imported_revision bigint NOT NULL,
  rolled_back boolean NOT NULL DEFAULT false,
  PRIMARY KEY(owner_id,fingerprint)
);
