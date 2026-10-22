import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";

export type ProjectStatus = "active" | "archived";

export type ProjectRecord = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  repositoryPath: string | null;
  createdAt: string;
};

export type MainConversationRecord = {
  id: string;
  projectId: string;
  kind: "main";
  createdAt: string;
};

export type ProjectAggregate = {
  project: ProjectRecord;
  mainConversation: MainConversationRecord;
};

export type CreateProjectInput = {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  idempotencyKey: string;
  mainConversationId?: string;
};

export type ListProjectsInput = {
  organizationId?: string;
  includeArchived?: boolean;
};

export type UpdateProjectInput = {
  projectId: string;
  name?: string;
  description?: string | null;
};

export class ProjectServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "ProjectServiceError";
  }
}

type ConversationRow = {
  id: string;
  projectId: string;
  kind: "main";
  createdAt: string;
};

type CreationRequestRow = {
  idempotencyKey: string;
  projectId: string;
  requestFingerprint: string;
};

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProjectServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function fingerprint(input: CreateProjectInput) {
  return JSON.stringify({
    id: input.id,
    organizationId: input.organizationId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    mainConversationId: input.mainConversationId ?? null,
  });
}

export class ProjectService {
  constructor(private readonly database: DatabaseSync) {}

  createProject(input: CreateProjectInput): ProjectAggregate {
    const id = requireText(input.id, "id");
    const organizationId = requireText(input.organizationId, "organizationId");
    const name = requireText(input.name, "name");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const description = input.description?.trim() || null;
    const requestFingerprint = fingerprint({ ...input, id, organizationId, name });

    return transaction(this.database, () => {
      const existingRequest = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              project_id AS projectId,
              request_fingerprint AS requestFingerprint
            FROM project_creation_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as CreationRequestRow | undefined;

      if (existingRequest) {
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new ProjectServiceError(
            "CONFLICT",
            "Idempotency key was already used for another project request",
          );
        }
        return this.readAggregate(existingRequest.projectId);
      }

      const mainConversationId = input.mainConversationId?.trim() || randomUUID();
      this.database
        .prepare(
          `
            INSERT INTO projects (id, organization_id, name, description)
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(id, organizationId, name, description);
      this.database
        .prepare(
          `
            INSERT INTO conversations (id, project_id, kind)
            VALUES (?, ?, 'main')
          `,
        )
        .run(mainConversationId, id);
      this.database
        .prepare(
          `
            INSERT INTO project_creation_requests
              (idempotency_key, project_id, request_fingerprint)
            VALUES (?, ?, ?)
          `,
        )
        .run(idempotencyKey, id, requestFingerprint);

      return this.readAggregate(id);
    });
  }

  listProjects(input: ListProjectsInput = {}): ProjectRecord[] {
    const conditions = ["1 = 1"];
    const parameters: string[] = [];
    if (input.organizationId) {
      conditions.push("organization_id = ?");
      parameters.push(input.organizationId);
    }
    if (!input.includeArchived) conditions.push("status = 'active'");

    return this.database
      .prepare(
        `
          SELECT
            id,
            organization_id AS organizationId,
            name,
            description,
            status,
            repository_path AS repositoryPath,
            created_at AS createdAt
          FROM projects
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at, id
        `,
      )
      .all(...parameters) as ProjectRecord[];
  }

  updateProject(input: UpdateProjectInput): ProjectRecord {
    return transaction(this.database, () => {
      const current = this.readProject(input.projectId);
      if (!current) {
        throw new ProjectServiceError("NOT_FOUND", "Project not found");
      }
      if (current.status !== "active") {
        throw new ProjectServiceError("FORBIDDEN", "Archived projects are not mutable");
      }
      const name =
        input.name === undefined ? current.name : requireText(input.name, "name");
      const description =
        input.description === undefined
          ? current.description
          : input.description?.trim() || null;
      this.database
        .prepare("UPDATE projects SET name = ?, description = ? WHERE id = ?")
        .run(name, description, input.projectId);
      return this.readProject(input.projectId) as ProjectRecord;
    });
  }

  archiveProject(projectId: string): ProjectRecord {
    return transaction(this.database, () => {
      const current = this.readProject(projectId);
      if (!current) {
        throw new ProjectServiceError("NOT_FOUND", "Project not found");
      }
      if (current.status === "active") {
        this.database
          .prepare("UPDATE projects SET status = 'archived' WHERE id = ?")
          .run(projectId);
      }
      return this.readProject(projectId) as ProjectRecord;
    });
  }

  private readProject(projectId: string): ProjectRecord | undefined {
    return this.database
      .prepare(
        `
          SELECT
            id,
            organization_id AS organizationId,
            name,
            description,
            status,
            repository_path AS repositoryPath,
            created_at AS createdAt
          FROM projects
          WHERE id = ?
        `,
      )
      .get(projectId) as ProjectRecord | undefined;
  }

  private readAggregate(projectId: string): ProjectAggregate {
    const project = this.readProject(projectId);
    const mainConversation = this.database
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            kind,
            created_at AS createdAt
          FROM conversations
          WHERE project_id = ? AND kind = 'main'
        `,
      )
      .get(projectId) as ConversationRow | undefined;
    if (!project || !mainConversation) {
      throw new ProjectServiceError(
        "CONFLICT",
        "Project main conversation is incomplete",
      );
    }
    return { project, mainConversation };
  }
}
