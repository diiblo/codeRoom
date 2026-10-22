CREATE TABLE IF NOT EXISTS assignment_creation_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  assignment_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE RESTRICT
);
