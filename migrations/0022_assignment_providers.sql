ALTER TABLE assignments ADD COLUMN provider TEXT;

UPDATE assignments
SET provider = (
  SELECT NULLIF(provider, '__unassigned__')
  FROM agents
  WHERE agents.id = assignments.agent_id
)
WHERE provider IS NULL;

CREATE INDEX IF NOT EXISTS assignments_provider_index
  ON assignments (provider);
