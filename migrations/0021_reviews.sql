CREATE TABLE IF NOT EXISTS ticket_review_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  ticket_id TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  execution_id TEXT,
  project_id TEXT NOT NULL,
  submitter_type TEXT NOT NULL CHECK (submitter_type IN ('agent', 'human')),
  submitter_id TEXT NOT NULL CHECK (length(trim(submitter_id)) > 0),
  request_fingerprint TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT,
  FOREIGN KEY (deliverable_id) REFERENCES deliverables(id) ON DELETE RESTRICT,
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ticket_review_submissions_ticket_index
  ON ticket_review_submissions (ticket_id, submitted_at, id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY NOT NULL,
  ticket_id TEXT NOT NULL,
  deliverable_id TEXT NOT NULL,
  execution_id TEXT,
  project_id TEXT NOT NULL,
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('agent', 'human')),
  reviewer_id TEXT NOT NULL CHECK (length(trim(reviewer_id)) > 0),
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE RESTRICT,
  FOREIGN KEY (deliverable_id) REFERENCES deliverables(id) ON DELETE RESTRICT,
  FOREIGN KEY (execution_id) REFERENCES executions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS reviews_ticket_index
  ON reviews (ticket_id, created_at, id);

CREATE TABLE IF NOT EXISTS review_requests (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS review_action_requests (
  id TEXT PRIMARY KEY NOT NULL,
  action_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL
    CHECK (action_type IN ('ticket.submit_review', 'review.submit')),
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

CREATE INDEX IF NOT EXISTS review_action_requests_ticket_index
  ON review_action_requests (ticket_id, created_at, id);
