ALTER TABLE agents ADD COLUMN description TEXT;

CREATE TABLE IF NOT EXISTS providers (
  provider TEXT PRIMARY KEY NOT NULL CHECK (length(trim(provider)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  status TEXT NOT NULL DEFAULT 'unavailable'
    CHECK (status IN ('available', 'unavailable', 'not-installed', 'unsupported')),
  capabilities TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS providers_status_index
  ON providers (status);
