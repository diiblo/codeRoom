CREATE TABLE IF NOT EXISTS mention_intentions (
  id TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL CHECK (length(trim(target_agent_id)) > 0),
  trigger_kind TEXT NOT NULL DEFAULT 'mention'
    CHECK (trigger_kind = 'mention'),
  status TEXT NOT NULL
    CHECK (status IN ('queued', 'rejected')),
  assignment_id TEXT,
  execution_id TEXT UNIQUE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT,
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT,
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  UNIQUE (message_id, target_agent_id, trigger_kind)
);

CREATE INDEX IF NOT EXISTS mention_intentions_message_index
  ON mention_intentions (message_id, created_at, id);

CREATE INDEX IF NOT EXISTS mention_intentions_project_index
  ON mention_intentions (project_id, created_at, id);
