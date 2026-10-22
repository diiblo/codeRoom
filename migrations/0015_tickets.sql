CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  author_type TEXT NOT NULL CHECK (author_type IN ('agent', 'human', 'system')),
  author_id TEXT NOT NULL CHECK (length(trim(author_id)) > 0),
  owner_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'todo'
    CHECK (state IN ('todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
  blocked_from_state TEXT
    CHECK (blocked_from_state IS NULL OR blocked_from_state IN ('todo', 'in_progress', 'in_review')),
  blocked_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS tickets_project_state_index
  ON tickets (project_id, state, updated_at, id);

CREATE INDEX IF NOT EXISTS tickets_owner_index
  ON tickets (project_id, owner_id, state, id);

CREATE TABLE IF NOT EXISTS ticket_creation_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS ticket_transitions (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL,
  from_state TEXT
    CHECK (from_state IS NULL OR from_state IN ('todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
  to_state TEXT NOT NULL
    CHECK (to_state IN ('todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
  actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ticket_transitions_order_index
  ON ticket_transitions (ticket_id, created_at, id);

CREATE TABLE IF NOT EXISTS ticket_transition_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL,
  transition_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT,
  FOREIGN KEY (transition_id) REFERENCES ticket_transitions(id) ON DELETE RESTRICT
);
