import type { DatabaseSync } from "../db/sqlite.js";
import { CANONICAL_PERMISSIONS, type Permission } from "../security/authorization.js";
import { transaction } from "../db/repository.js";

export type AssignmentStatus = "active" | "archived";

export type AssignmentRecord = {
  id: string;
  projectId: string;
  agentId: string;
  provider: string | null;
  permissionSet: Permission[];
  status: AssignmentStatus;
  archivedAt: string | null;
  createdAt: string;
};

export type CreateAssignmentInput = {
  id: string;
  projectId: string;
  agentId: string;
  provider?: string | null;
  permissionSet: readonly string[];
  idempotencyKey: string;
};

export type UpdateAssignmentPermissionsInput = {
  assignmentId: string;
  permissionSet: readonly string[];
};

export type ListAssignmentsInput = {
  projectId: string;
  includeArchived?: boolean;
};

export class AssignmentServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AssignmentServiceError";
  }
}

type AssignmentRow = {
  id: string;
  projectId: string;
  agentId: string;
  provider: string | null;
  permissionSet: string;
  status: AssignmentStatus;
  archivedAt: string | null;
  createdAt: string;
};

type CreationRequestRow = {
  idempotencyKey: string;
  assignmentId: string;
  requestFingerprint: string;
};

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new AssignmentServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function optionalProvider(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizePermissionSet(input: readonly string[]): Permission[] {
  for (const permission of input) {
    if (!(CANONICAL_PERMISSIONS as readonly string[]).includes(permission)) {
      throw new AssignmentServiceError(
        "VALIDATION_ERROR",
        `Unknown permission: ${permission}`,
      );
    }
  }
  return CANONICAL_PERMISSIONS.filter((permission) => input.includes(permission));
}

function serializePermissionSet(permissionSet: readonly Permission[]) {
  return JSON.stringify(permissionSet);
}

function parsePermissionSet(value: string): Permission[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return CANONICAL_PERMISSIONS.filter((permission) => parsed.includes(permission));
  } catch {
    return [];
  }
}

function fingerprint(input: {
  id: string;
  projectId: string;
  agentId: string;
  provider: string | null;
  permissionSet: readonly Permission[];
}) {
  return JSON.stringify({
    id: input.id,
    projectId: input.projectId,
    agentId: input.agentId,
    provider: input.provider,
    permissionSet: input.permissionSet,
  });
}

export class AssignmentService {
  constructor(private readonly database: DatabaseSync) {}

  createAssignment(input: CreateAssignmentInput): AssignmentRecord {
    const id = requireText(input.id, "id");
    const projectId = requireText(input.projectId, "projectId");
    const agentId = requireText(input.agentId, "agentId");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const permissionSet = normalizePermissionSet(input.permissionSet);

    return transaction(this.database, () => {
      const provider =
        input.provider === undefined
          ? this.readLegacyAgentProvider(agentId)
          : optionalProvider(input.provider);
      const requestFingerprint = fingerprint({
        id,
        projectId,
        agentId,
        provider,
        permissionSet,
      });
      const existingRequest = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              assignment_id AS assignmentId,
              request_fingerprint AS requestFingerprint
            FROM assignment_creation_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as CreationRequestRow | undefined;
      if (existingRequest) {
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new AssignmentServiceError(
            "CONFLICT",
            "Idempotency key was already used for another assignment request",
          );
        }
        return this.readAssignment(existingRequest.assignmentId) as AssignmentRecord;
      }

      if (this.readAssignment(id)) {
        throw new AssignmentServiceError("CONFLICT", "Assignment id is already in use");
      }
      this.assertProjectActive(projectId);
      this.assertAgentActive(agentId);

      const duplicate = this.database
        .prepare(
          `
            SELECT id
            FROM assignments
            WHERE project_id = ? AND agent_id = ? AND status = 'active'
          `,
        )
        .get(projectId, agentId) as { id: string } | undefined;
      if (duplicate) {
        throw new AssignmentServiceError(
          "CONFLICT",
          "An active assignment already exists for this project and agent",
        );
      }

      this.database
        .prepare(
          `
            INSERT INTO assignments (id, project_id, agent_id, provider, permission_set)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(id, projectId, agentId, provider, serializePermissionSet(permissionSet));
      this.database
        .prepare(
          `
            INSERT INTO assignment_creation_requests
              (idempotency_key, assignment_id, request_fingerprint)
            VALUES (?, ?, ?)
          `,
        )
        .run(idempotencyKey, id, requestFingerprint);
      return this.readAssignment(id) as AssignmentRecord;
    });
  }

  getAssignment(assignmentIdInput: string): AssignmentRecord | undefined {
    return this.readAssignment(requireText(assignmentIdInput, "assignmentId"));
  }

  listAssignments(input: ListAssignmentsInput): AssignmentRecord[] {
    const projectId = requireText(input.projectId, "projectId");
    this.assertProjectExists(projectId);
    const statusCondition = input.includeArchived ? "" : "AND status = 'active'";
    return this.database
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            agent_id AS agentId,
            provider,
            permission_set AS permissionSet,
            status,
            archived_at AS archivedAt,
            created_at AS createdAt
          FROM assignments
          WHERE project_id = ? ${statusCondition}
          ORDER BY created_at, id
        `,
      )
      .all(projectId)
      .map((row) => this.assignmentFromRow(row as AssignmentRow));
  }

  updatePermissions(input: UpdateAssignmentPermissionsInput): AssignmentRecord {
    const assignmentId = requireText(input.assignmentId, "assignmentId");
    const permissionSet = normalizePermissionSet(input.permissionSet);
    return transaction(this.database, () => {
      const current = this.readAssignment(assignmentId);
      if (!current) {
        throw new AssignmentServiceError("NOT_FOUND", "Assignment not found");
      }
      if (current.status !== "active") {
        throw new AssignmentServiceError(
          "FORBIDDEN",
          "Archived assignments are not mutable",
        );
      }
      this.assertProjectActive(current.projectId);
      this.assertAgentActive(current.agentId);
      this.database
        .prepare("UPDATE assignments SET permission_set = ? WHERE id = ?")
        .run(serializePermissionSet(permissionSet), assignmentId);
      return this.readAssignment(assignmentId) as AssignmentRecord;
    });
  }

  archiveAssignment(assignmentIdInput: string): AssignmentRecord {
    const assignmentId = requireText(assignmentIdInput, "assignmentId");
    return transaction(this.database, () => {
      const current = this.readAssignment(assignmentId);
      if (!current) {
        throw new AssignmentServiceError("NOT_FOUND", "Assignment not found");
      }
      if (current.status === "active") {
        this.database
          .prepare(
            "UPDATE assignments SET status = 'archived', archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
          )
          .run(assignmentId);
      }
      return this.readAssignment(assignmentId) as AssignmentRecord;
    });
  }

  private assertProjectExists(projectId: string) {
    const project = this.database
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get(projectId) as { status: "active" | "archived" } | undefined;
    if (!project) {
      throw new AssignmentServiceError("NOT_FOUND", "Project not found");
    }
    return project;
  }

  private assertProjectActive(projectId: string) {
    const project = this.assertProjectExists(projectId);
    if (project.status !== "active") {
      throw new AssignmentServiceError(
        "FORBIDDEN",
        "Archived projects cannot receive assignment changes",
      );
    }
  }

  private assertAgentActive(agentId: string) {
    const agent = this.database
      .prepare("SELECT archived_at AS archivedAt FROM agents WHERE id = ?")
      .get(agentId) as { archivedAt: string | null } | undefined;
    if (!agent) {
      throw new AssignmentServiceError("NOT_FOUND", "Agent not found");
    }
    if (agent.archivedAt !== null) {
      throw new AssignmentServiceError(
        "FORBIDDEN",
        "Archived agents cannot receive active assignments",
      );
    }
  }

  private readLegacyAgentProvider(agentId: string) {
    const row = this.database
      .prepare("SELECT provider FROM agents WHERE id = ?")
      .get(agentId) as { provider: string } | undefined;
    return row?.provider && row.provider !== "__unassigned__" ? row.provider : null;
  }

  private readAssignment(assignmentId: string): AssignmentRecord | undefined {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            agent_id AS agentId,
            provider,
            permission_set AS permissionSet,
            status,
            archived_at AS archivedAt,
            created_at AS createdAt
          FROM assignments
          WHERE id = ?
        `,
      )
      .get(assignmentId) as AssignmentRow | undefined;
    return row ? this.assignmentFromRow(row) : undefined;
  }

  private assignmentFromRow(row: AssignmentRow): AssignmentRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      agentId: row.agentId,
      provider: row.provider,
      permissionSet: parsePermissionSet(row.permissionSet),
      status: row.status,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
    };
  }
}
