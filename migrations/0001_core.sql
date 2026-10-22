CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  role TEXT NOT NULL CHECK (length(trim(role)) > 0),
  instructions TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  repository_path TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  permission_set TEXT NOT NULL DEFAULT '[]'
    CHECK (length(trim(permission_set)) > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_organization_name_unique
  ON projects (organization_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS assignments_active_pair_unique
  ON assignments (project_id, agent_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS projects_organization_id_index
  ON projects (organization_id);

CREATE INDEX IF NOT EXISTS assignments_project_id_index
  ON assignments (project_id);

CREATE INDEX IF NOT EXISTS assignments_agent_id_index
  ON assignments (agent_id);
