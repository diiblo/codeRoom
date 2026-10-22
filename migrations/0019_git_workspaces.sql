CREATE TABLE IF NOT EXISTS git_workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  ticket_id TEXT,
  repository_path TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('shared_repository')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'retired')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  retired_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS git_workspaces_project_ticket_unique
  ON git_workspaces (project_id, ticket_id)
  WHERE status = 'active' AND ticket_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS git_workspaces_project_unique
  ON git_workspaces (project_id)
  WHERE status = 'active' AND ticket_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS git_workspaces_ticket_unique
  ON git_workspaces (ticket_id)
  WHERE status = 'active' AND ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS git_workspaces_project_index
  ON git_workspaces (project_id, status, id);

CREATE TABLE IF NOT EXISTS git_workspace_allocation_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES git_workspaces(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS git_workspace_locks (
  repository_path TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  grant_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('held', 'released', 'reconciliation_required')),
  owner_id TEXT NOT NULL,
  execution_id TEXT,
  lock_token TEXT NOT NULL UNIQUE,
  lease_expires_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES git_workspaces(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS git_workspace_locks_workspace_index
  ON git_workspace_locks (workspace_id, status);

CREATE TABLE IF NOT EXISTS git_workspace_lock_grants (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  execution_id TEXT,
  lock_token TEXT NOT NULL UNIQUE,
  lease_expires_at TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  released_at TEXT,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (workspace_id) REFERENCES git_workspaces(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS git_workspace_lock_grants_workspace_index
  ON git_workspace_lock_grants (workspace_id, created_at, id);
