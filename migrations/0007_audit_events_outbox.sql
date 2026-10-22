CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL CHECK (length(trim(event_type)) > 0),
  version INTEGER NOT NULL CHECK (version > 0),
  project_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  correlation_id TEXT NOT NULL CHECK (length(trim(correlation_id)) > 0),
  causation_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS audit_events_project_order_index
  ON audit_events (project_id, created_at, id);

CREATE TABLE IF NOT EXISTS event_outbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  available_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  FOREIGN KEY (event_id) REFERENCES audit_events(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS event_outbox_pending_index
  ON event_outbox (published_at, available_at, event_id);
