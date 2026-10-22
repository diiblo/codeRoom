ALTER TABLE execution_sessions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked'));

ALTER TABLE execution_sessions
  ADD COLUMN context_scope TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS execution_sessions_status_index
  ON execution_sessions (status, project_id, assignment_id, id);
