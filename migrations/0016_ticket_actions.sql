CREATE TABLE IF NOT EXISTS ticket_action_requests (
  id TEXT PRIMARY KEY NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL
    CHECK (action_type IN ('ticket.create', 'ticket.assign', 'ticket.update')),
  execution_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  ticket_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ticket_action_requests_ticket_index
  ON ticket_action_requests (ticket_id, created_at, id);
