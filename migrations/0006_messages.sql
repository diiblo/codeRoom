CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  conversation_id TEXT NOT NULL,
  author_type TEXT NOT NULL CHECK (author_type IN ('agent', 'human', 'system')),
  author_id TEXT NOT NULL CHECK (length(trim(author_id)) > 0),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  message_references TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS messages_conversation_order_index
  ON messages (conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS message_creation_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  message_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE RESTRICT
);
