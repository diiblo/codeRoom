CREATE TABLE IF NOT EXISTS message_send_actions (
  id TEXT PRIMARY KEY NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  execution_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS message_send_actions_execution_index
  ON message_send_actions (execution_id, created_at, id);

CREATE INDEX IF NOT EXISTS message_send_actions_project_index
  ON message_send_actions (project_id, created_at, id);
