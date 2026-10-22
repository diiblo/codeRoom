CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY NOT NULL,
  action_request_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (length(trim(action_type)) > 0),
  required_permission TEXT NOT NULL CHECK (length(trim(required_permission)) > 0),
  payload TEXT NOT NULL DEFAULT '{}',
  context_fingerprint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by_type TEXT
    CHECK (decided_by_type IS NULL OR decided_by_type IN ('human', 'system')),
  decided_by_id TEXT,
  decision_reason TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS approvals_project_idempotency_unique
  ON approvals (project_id, idempotency_key);

CREATE INDEX IF NOT EXISTS approvals_inbox_index
  ON approvals (project_id, status, requested_at, id);

CREATE INDEX IF NOT EXISTS approvals_execution_index
  ON approvals (execution_id, status, requested_at, id);
