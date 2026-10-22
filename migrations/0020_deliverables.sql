CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL,
  execution_id TEXT,
  project_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  git_ref TEXT NOT NULL CHECK (length(trim(git_ref)) > 0),
  git_commit TEXT NOT NULL CHECK (length(trim(git_commit)) = 40),
  git_branch TEXT,
  working_tree_status TEXT NOT NULL CHECK (working_tree_status IN ('clean', 'dirty')),
  diff_text TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'submitted'
    CHECK (state IN ('submitted', 'rejected')),
  submitted_by_type TEXT NOT NULL CHECK (submitted_by_type IN ('agent', 'human', 'system')),
  submitted_by_id TEXT NOT NULL CHECK (length(trim(submitted_by_id)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT,
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id) REFERENCES git_workspaces(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS deliverables_ticket_index
  ON deliverables (ticket_id, created_at, id);

CREATE INDEX IF NOT EXISTS deliverables_project_index
  ON deliverables (project_id, created_at, id);

CREATE TABLE IF NOT EXISTS deliverable_submission_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  deliverable_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (deliverable_id) REFERENCES deliverables(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS deliverable_test_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  deliverable_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (length(trim(command)) > 0),
  source TEXT NOT NULL CHECK (source IN ('runner')),
  outcome TEXT NOT NULL CHECK (outcome IN ('passed', 'failed', 'blocked')),
  exit_code INTEGER,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (deliverable_id) REFERENCES deliverables(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS deliverable_test_evidence_deliverable_index
  ON deliverable_test_evidence (deliverable_id, created_at, id);
