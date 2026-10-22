CREATE UNIQUE INDEX IF NOT EXISTS projects_repository_path_unique
  ON projects (repository_path)
  WHERE repository_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_repository_link_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  readable INTEGER NOT NULL CHECK (readable IN (0, 1)),
  writable INTEGER NOT NULL CHECK (writable IN (0, 1)),
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS project_repository_link_requests_project_id_index
  ON project_repository_link_requests (project_id);
