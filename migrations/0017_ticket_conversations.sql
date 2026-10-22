ALTER TABLE conversations
  ADD COLUMN ticket_id TEXT REFERENCES tickets(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_ticket_unique
  ON conversations (ticket_id)
  WHERE kind = 'ticket' AND ticket_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS conversations_ticket_id_index
  ON conversations (ticket_id);

INSERT INTO conversations (id, project_id, kind, ticket_id)
SELECT
  'ticket_conversation_' || lower(hex(randomblob(16))),
  t.project_id,
  'ticket',
  t.id
FROM tickets t
WHERE NOT EXISTS (
  SELECT 1
  FROM conversations c
  WHERE c.ticket_id = t.id AND c.kind = 'ticket'
);
