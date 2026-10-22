import { accessSync, constants as fsConstants, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, parse, sep } from "node:path";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { EventService, type EventActor } from "../events/service.js";

export type RepositoryAccess = {
  readable: boolean;
  writable: boolean;
};

export type ProjectRepositoryRecord = {
  projectId: string;
  repositoryPath: string;
  access: RepositoryAccess;
};

export type LinkRepositoryInput = {
  projectId: string;
  path: string;
  idempotencyKey: string;
  actor: EventActor;
  correlationId: string;
};

export class ProjectRepositoryServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "ProjectRepositoryServiceError";
  }
}

type ProjectRow = {
  id: string;
  status: "active" | "archived";
  repositoryPath: string | null;
};

type LinkRequestRow = {
  idempotencyKey: string;
  projectId: string;
  repositoryPath: string;
  readable: number;
  writable: number;
  requestFingerprint: string;
};

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      `${field} must not be empty`,
    );
  }
  return normalized;
}

function hasTraversalSegment(path: string) {
  return path.split(/[\\/]+/).some((segment) => segment === "..");
}

function rejectSymlinkComponents(path: string) {
  const root = parse(path).root;
  const components = path.slice(root.length).split(sep).filter(Boolean);
  let current = root;

  for (const component of components) {
    current = join(current, component);
    let stats;
    try {
      stats = lstatSync(current);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        throw new ProjectRepositoryServiceError(
          "NOT_FOUND",
          "Repository path does not exist",
        );
      }
      if (code === "EACCES" || code === "EPERM") {
        throw new ProjectRepositoryServiceError(
          "FORBIDDEN",
          "Repository path cannot be accessed",
        );
      }
      throw new ProjectRepositoryServiceError(
        "VALIDATION_ERROR",
        "Repository path cannot be inspected",
      );
    }
    if (stats.isSymbolicLink()) {
      throw new ProjectRepositoryServiceError(
        "VALIDATION_ERROR",
        "Repository path must not contain symbolic links",
      );
    }
  }
}

function validateRepositoryPath(input: string): ProjectRepositoryRecord["access"] & {
  repositoryPath: string;
} {
  const requestedPath = requireText(input, "path");
  if (!isAbsolute(requestedPath)) {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Repository path must be absolute",
    );
  }
  if (requestedPath.includes("\0")) {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Repository path contains an invalid character",
    );
  }
  if (hasTraversalSegment(requestedPath)) {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Repository path must not contain traversal segments",
    );
  }

  rejectSymlinkComponents(requestedPath);

  let repositoryPath: string;
  try {
    repositoryPath = realpathSync(requestedPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new ProjectRepositoryServiceError(
        "NOT_FOUND",
        "Repository path does not exist",
      );
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new ProjectRepositoryServiceError(
        "FORBIDDEN",
        "Repository path cannot be accessed",
      );
    }
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Repository path cannot be canonicalized",
    );
  }

  let repositoryStats;
  try {
    repositoryStats = lstatSync(repositoryPath);
  } catch {
    throw new ProjectRepositoryServiceError(
      "NOT_FOUND",
      "Repository path does not exist",
    );
  }
  if (!repositoryStats.isDirectory()) {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Repository path must be a directory",
    );
  }

  const gitDirectory = join(repositoryPath, ".git");
  let gitStats;
  try {
    gitStats = lstatSync(gitDirectory);
  } catch {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Repository path is not a Git repository",
    );
  }
  if (gitStats.isSymbolicLink()) {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Git metadata must not be a symbolic link",
    );
  }
  if (!gitStats.isDirectory()) {
    throw new ProjectRepositoryServiceError(
      "VALIDATION_ERROR",
      "Git worktree indirection is not supported",
    );
  }

  for (const requiredEntry of ["HEAD", "config", "objects", "refs"]) {
    try {
      lstatSync(join(gitDirectory, requiredEntry));
    } catch {
      throw new ProjectRepositoryServiceError(
        "VALIDATION_ERROR",
        "Repository path is not a complete Git repository",
      );
    }
  }

  try {
    accessSync(repositoryPath, fsConstants.R_OK);
  } catch {
    throw new ProjectRepositoryServiceError(
      "FORBIDDEN",
      "Repository path is not readable",
    );
  }

  let writable = true;
  try {
    accessSync(repositoryPath, fsConstants.W_OK);
  } catch {
    writable = false;
  }

  return { repositoryPath, readable: true, writable };
}

function fingerprint(projectId: string, repositoryPath: string) {
  return JSON.stringify({ projectId, repositoryPath });
}

function recordFromRow(row: LinkRequestRow): ProjectRepositoryRecord {
  return {
    projectId: row.projectId,
    repositoryPath: row.repositoryPath,
    access: {
      readable: row.readable === 1,
      writable: row.writable === 1,
    },
  };
}

export class ProjectRepositoryService {
  private readonly events: EventService;

  constructor(private readonly database: DatabaseSync) {
    this.events = new EventService(database);
  }

  linkRepository(input: LinkRepositoryInput): ProjectRepositoryRecord {
    const projectId = requireText(input.projectId, "projectId");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const correlationId = requireText(input.correlationId, "correlationId");
    const validated = validateRepositoryPath(input.path);
    const requestFingerprint = fingerprint(projectId, validated.repositoryPath);

    return transaction(this.database, () => {
      const existingRequest = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              project_id AS projectId,
              repository_path AS repositoryPath,
              readable,
              writable,
              request_fingerprint AS requestFingerprint
            FROM project_repository_link_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as LinkRequestRow | undefined;

      if (existingRequest) {
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new ProjectRepositoryServiceError(
            "CONFLICT",
            "Idempotency key was already used for another repository link",
          );
        }
        return recordFromRow(existingRequest);
      }

      const project = this.database
        .prepare(
          `
            SELECT
              id,
              status,
              repository_path AS repositoryPath
            FROM projects
            WHERE id = ?
          `,
        )
        .get(projectId) as ProjectRow | undefined;
      if (!project) {
        throw new ProjectRepositoryServiceError("NOT_FOUND", "Project not found");
      }
      if (project.status !== "active") {
        throw new ProjectRepositoryServiceError(
          "FORBIDDEN",
          "Archived projects are not mutable",
        );
      }
      if (
        project.repositoryPath &&
        project.repositoryPath !== validated.repositoryPath
      ) {
        throw new ProjectRepositoryServiceError(
          "CONFLICT",
          "Project already has another repository linked",
        );
      }

      const otherProject = this.database
        .prepare(
          `
            SELECT id
            FROM projects
            WHERE repository_path = ? AND id <> ?
          `,
        )
        .get(validated.repositoryPath, projectId) as { id: string } | undefined;
      if (otherProject) {
        throw new ProjectRepositoryServiceError(
          "CONFLICT",
          "Repository is already linked to another project",
        );
      }

      const record: ProjectRepositoryRecord = {
        projectId,
        repositoryPath: validated.repositoryPath,
        access: {
          readable: validated.readable,
          writable: validated.writable,
        },
      };

      if (!project.repositoryPath) {
        this.database
          .prepare("UPDATE projects SET repository_path = ? WHERE id = ?")
          .run(record.repositoryPath, projectId);
        this.events.recordEvent({
          type: "project.repository_linked",
          version: 1,
          projectId,
          actor: input.actor,
          correlationId,
          payload: {
            repositoryPath: record.repositoryPath,
            readable: record.access.readable,
            writable: record.access.writable,
          },
        });
      }

      this.database
        .prepare(
          `
            INSERT INTO project_repository_link_requests
              (idempotency_key, project_id, repository_path, readable, writable,
               request_fingerprint)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          idempotencyKey,
          projectId,
          record.repositoryPath,
          record.access.readable ? 1 : 0,
          record.access.writable ? 1 : 0,
          requestFingerprint,
        );

      return record;
    });
  }
}
