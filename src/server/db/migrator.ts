import { readFileSync } from "node:fs";
import type { DatabaseSync } from "./sqlite.js";

export type Migration = {
  version: number;
  name: string;
  sql: string;
};

const coreMigration: Migration = {
  version: 1,
  name: "core",
  sql: readFileSync(
    new URL("../../../migrations/0001_core.sql", import.meta.url),
    "utf8",
  ),
};

const projectConversationMigration: Migration = {
  version: 2,
  name: "project_conversations",
  sql: readFileSync(
    new URL("../../../migrations/0002_project_conversations.sql", import.meta.url),
    "utf8",
  ),
};

const providerRegistryMigration: Migration = {
  version: 3,
  name: "provider_registry",
  sql: readFileSync(
    new URL("../../../migrations/0003_provider_registry.sql", import.meta.url),
    "utf8",
  ),
};

const assignmentRequestsMigration: Migration = {
  version: 4,
  name: "assignment_requests",
  sql: readFileSync(
    new URL("../../../migrations/0004_assignment_requests.sql", import.meta.url),
    "utf8",
  ),
};

const conversationParticipantsMigration: Migration = {
  version: 5,
  name: "conversation_participants",
  sql: readFileSync(
    new URL("../../../migrations/0005_conversation_participants.sql", import.meta.url),
    "utf8",
  ),
};

const messagesMigration: Migration = {
  version: 6,
  name: "messages",
  sql: readFileSync(
    new URL("../../../migrations/0006_messages.sql", import.meta.url),
    "utf8",
  ),
};

const auditEventsOutboxMigration: Migration = {
  version: 7,
  name: "audit_events_outbox",
  sql: readFileSync(
    new URL("../../../migrations/0007_audit_events_outbox.sql", import.meta.url),
    "utf8",
  ),
};

const executionsMigration: Migration = {
  version: 8,
  name: "executions",
  sql: readFileSync(
    new URL("../../../migrations/0008_executions.sql", import.meta.url),
    "utf8",
  ),
};

const executionSessionKeysMigration: Migration = {
  version: 9,
  name: "execution_session_keys",
  sql: readFileSync(
    new URL("../../../migrations/0009_execution_session_keys.sql", import.meta.url),
    "utf8",
  ),
};

const executionSessionScopeMigration: Migration = {
  version: 10,
  name: "execution_session_scope",
  sql: readFileSync(
    new URL("../../../migrations/0010_execution_session_scope.sql", import.meta.url),
    "utf8",
  ),
};

const mentionIntentionsMigration: Migration = {
  version: 11,
  name: "mention_intentions",
  sql: readFileSync(
    new URL("../../../migrations/0011_mention_intentions.sql", import.meta.url),
    "utf8",
  ),
};

const messageSendActionsMigration: Migration = {
  version: 12,
  name: "message_send_actions",
  sql: readFileSync(
    new URL("../../../migrations/0012_message_send_actions.sql", import.meta.url),
    "utf8",
  ),
};

const approvalsMigration: Migration = {
  version: 13,
  name: "approvals",
  sql: readFileSync(
    new URL("../../../migrations/0013_approvals.sql", import.meta.url),
    "utf8",
  ),
};

const initialLocalOrganizationMigration: Migration = {
  version: 14,
  name: "initial_local_organization",
  sql: readFileSync(
    new URL("../../../migrations/0014_initial_local_organization.sql", import.meta.url),
    "utf8",
  ),
};

const ticketsMigration: Migration = {
  version: 15,
  name: "tickets",
  sql: readFileSync(
    new URL("../../../migrations/0015_tickets.sql", import.meta.url),
    "utf8",
  ),
};

const ticketActionsMigration: Migration = {
  version: 16,
  name: "ticket_actions",
  sql: readFileSync(
    new URL("../../../migrations/0016_ticket_actions.sql", import.meta.url),
    "utf8",
  ),
};

const ticketConversationsMigration: Migration = {
  version: 17,
  name: "ticket_conversations",
  sql: readFileSync(
    new URL("../../../migrations/0017_ticket_conversations.sql", import.meta.url),
    "utf8",
  ),
};

const projectRepositoriesMigration: Migration = {
  version: 18,
  name: "project_repositories",
  sql: readFileSync(
    new URL("../../../migrations/0018_project_repositories.sql", import.meta.url),
    "utf8",
  ),
};

const gitWorkspacesMigration: Migration = {
  version: 19,
  name: "git_workspaces",
  sql: readFileSync(
    new URL("../../../migrations/0019_git_workspaces.sql", import.meta.url),
    "utf8",
  ),
};

const deliverablesMigration: Migration = {
  version: 20,
  name: "deliverables",
  sql: readFileSync(
    new URL("../../../migrations/0020_deliverables.sql", import.meta.url),
    "utf8",
  ),
};

const reviewsMigration: Migration = {
  version: 21,
  name: "reviews",
  sql: readFileSync(
    new URL("../../../migrations/0021_reviews.sql", import.meta.url),
    "utf8",
  ),
};

const assignmentProvidersMigration: Migration = {
  version: 22,
  name: "assignment_providers",
  sql: readFileSync(
    new URL("../../../migrations/0022_assignment_providers.sql", import.meta.url),
    "utf8",
  ),
};

export const migrations: readonly Migration[] = [
  coreMigration,
  projectConversationMigration,
  providerRegistryMigration,
  assignmentRequestsMigration,
  conversationParticipantsMigration,
  messagesMigration,
  auditEventsOutboxMigration,
  executionsMigration,
  executionSessionKeysMigration,
  executionSessionScopeMigration,
  mentionIntentionsMigration,
  messageSendActionsMigration,
  approvalsMigration,
  initialLocalOrganizationMigration,
  ticketsMigration,
  ticketActionsMigration,
  ticketConversationsMigration,
  projectRepositoriesMigration,
  gitWorkspacesMigration,
  deliverablesMigration,
  reviewsMigration,
  assignmentProvidersMigration,
];

function validateMigrations(pendingMigrations: readonly Migration[]) {
  const versions = new Set<number>();
  for (const migration of pendingMigrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error("Migration version must be a positive integer");
    }
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    versions.add(migration.version);
  }
}

function ensureMigrationTable(database: DatabaseSync) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

export function applyMigrations(
  database: DatabaseSync,
  pendingMigrations: readonly Migration[] = migrations,
) {
  validateMigrations(pendingMigrations);
  ensureMigrationTable(database);

  const orderedMigrations = [...pendingMigrations].sort(
    (left, right) => left.version - right.version,
  );
  const appliedVersions = new Set(
    database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number((row as { version: number }).version)),
  );

  const highestKnownVersion = orderedMigrations.at(-1)?.version ?? 0;
  const unknownAppliedVersion = [...appliedVersions].find(
    (version) => version > highestKnownVersion,
  );
  if (unknownAppliedVersion !== undefined) {
    throw new Error(
      `Database schema version ${unknownAppliedVersion} is newer than this application`,
    );
  }

  for (const migration of orderedMigrations) {
    if (appliedVersions.has(migration.version)) continue;

    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
