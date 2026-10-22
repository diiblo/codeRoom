CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  trigger_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  instruction TEXT NOT NULL CHECK (length(trim(instruction)) > 0),
  context_refs TEXT NOT NULL DEFAULT '[]',
  requested_workspace_id TEXT,
  parent_execution_id TEXT,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'unknown')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  cancel_requested_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  result TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_execution_id) REFERENCES executions(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS executions_project_trigger_unique
  ON executions (project_id, trigger_id);

CREATE UNIQUE INDEX IF NOT EXISTS executions_project_idempotency_unique
  ON executions (project_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS executions_active_assignment_unique
  ON executions (assignment_id)
  WHERE state IN ('queued', 'running', 'awaiting_approval');

CREATE INDEX IF NOT EXISTS executions_queue_index
  ON executions (state, created_at, id);

CREATE INDEX IF NOT EXISTS executions_lease_index
  ON executions (state, lease_expires_at, id);

CREATE TABLE IF NOT EXISTS execution_transitions (
  id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL,
  from_state TEXT
    CHECK (from_state IS NULL OR from_state IN ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'unknown')),
  to_state TEXT NOT NULL
    CHECK (to_state IN ('queued', 'running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled', 'unknown')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS execution_transitions_execution_order_index
  ON execution_transitions (execution_id, created_at, id);

CREATE TABLE IF NOT EXISTS execution_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  execution_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  provider_session_key TEXT,
  provider_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS execution_sessions_project_index
  ON execution_sessions (project_id, assignment_id, id);
