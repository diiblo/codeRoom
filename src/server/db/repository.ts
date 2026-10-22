import type { DatabaseSync } from "./sqlite.js";

type OrganizationInput = {
  id: string;
  name: string;
};

type AgentInput = {
  id: string;
  provider?: string;
  displayName: string;
  role: string;
  instructions?: string;
};

type ProjectInput = {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
};

type AssignmentInput = {
  id: string;
  projectId: string;
  agentId: string;
  provider?: string | null;
  permissionSet?: readonly string[];
};

export function transaction<T>(database: DatabaseSync, work: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function createCoreRepository(database: DatabaseSync) {
  return {
    createOrganization(input: OrganizationInput) {
      database
        .prepare("INSERT INTO organizations (id, name) VALUES (?, ?)")
        .run(input.id, input.name);
    },

    createAgent(input: AgentInput) {
      database
        .prepare(
          "INSERT INTO agents (id, provider, display_name, role, instructions) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.provider ?? "__unassigned__",
          input.displayName,
          input.role,
          input.instructions ?? "",
        );
    },

    createProject(input: ProjectInput) {
      database
        .prepare(
          "INSERT INTO projects (id, organization_id, name, description) VALUES (?, ?, ?, ?)",
        )
        .run(input.id, input.organizationId, input.name, input.description ?? null);
    },

    createAssignment(input: AssignmentInput) {
      database
        .prepare(
          "INSERT INTO assignments (id, project_id, agent_id, provider, permission_set) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          input.id,
          input.projectId,
          input.agentId,
          input.provider ?? null,
          JSON.stringify(input.permissionSet ?? []),
        );
    },
  };
}
