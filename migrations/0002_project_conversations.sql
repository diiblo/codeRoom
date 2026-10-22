CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('main', 'direct', 'ticket')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS conversations_project_main_unique
  ON conversations (project_id)
  WHERE kind = 'main';

CREATE INDEX IF NOT EXISTS conversations_project_id_index
  ON conversations (project_id);

CREATE TABLE IF NOT EXISTS project_creation_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);
