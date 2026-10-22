import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { EventService, type EventActor } from "../events/service.js";

export const WORKSPACE_STRATEGIES = ["shared_repository"] as const;
export type WorkspaceStrategy = (typeof WORKSPACE_STRATEGIES)[number];
export type WorkspaceStatus = "active" | "retired";
export type WorkspaceLockStatus = "held" | "released" | "reconciliation_required";

export type WorkspaceRecord = {
  id: string;
  projectId: string;
  ticketId: string | null;
  repositoryPath: string;
  workspacePath: string;
  strategy: WorkspaceStrategy;
  status: WorkspaceStatus;
  createdAt: string;
  retiredAt: string | null;
};

export type WorkspaceLockRecord = {
  repositoryPath: string;
  workspaceId: string;
  grantId: string;
  status: WorkspaceLockStatus;
  ownerId: string;
  executionId: string | null;
  lockToken: string;
  leaseExpiresAt: string;
  acquiredAt: string;
  updatedAt: string;
};

export type WorkspaceServiceOptions = {
  now?: () => string;
  defaultLeaseDurationMs?: number;
};

export type AllocateWorkspaceInput = {
  id?: string;
  projectId: string;
  ticketId?: string;
  idempotencyKey: string;
  actor?: EventActor;
  correlationId?: string;
};

export type AcquireWorkspaceLockInput = {
  workspaceId: string;
  ownerId: string;
  executionId?: string;
  idempotencyKey: string;
  leaseDurationMs?: number;
  actor?: EventActor;
  correlationId?: string;
  now?: string;
};

export type ReleaseWorkspaceLockInput = {
  workspaceId: string;
  ownerId: string;
  lockToken: string;
  actor?: EventActor;
  correlationId?: string;
  now?: string;
};

export type ReconcileWorkspaceLockInput = {
  workspaceId: string;
  actor: EventActor;
  reason: string;
  correlationId?: string;
  now?: string;
};

export class WorkspaceServiceError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "LEASE_LOST",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceServiceError";
  }
}

type WorkspaceRow = {
  id: string;
  projectId: string;
  ticketId: string | null;
  repositoryPath: string;
  workspacePath: string;
  strategy: WorkspaceStrategy;
  status: WorkspaceStatus;
  createdAt: string;
  retiredAt: string | null;
};

type AllocationRequestRow = {
  idempotencyKey: string;
  workspaceId: string;
  projectId: string;
  requestFingerprint: string;
};

type LockRow = {
  repositoryPath: string;
  workspaceId: string;
  grantId: string;
  status: WorkspaceLockStatus;
  ownerId: string;
  executionId: string | null;
  lockToken: string;
  leaseExpiresAt: string;
  acquiredAt: string;
  updatedAt: string;
};

type GrantRow = {
  id: string;
  idempotencyKey: string;
  workspaceId: string;
  repositoryPath: string;
  ownerId: string;
  executionId: string | null;
  lockToken: string;
  leaseExpiresAt: string;
  acquiredAt: string;
  releasedAt: string | null;
  requestFingerprint: string;
};

const WORKSPACE_SELECT = `
  SELECT
    id,
    project_id AS projectId,
    ticket_id AS ticketId,
    repository_path AS repositoryPath,
    workspace_path AS workspacePath,
    strategy,
    status,
    created_at AS createdAt,
    retired_at AS retiredAt
  FROM git_workspaces
`;

const LOCK_SELECT = `
  SELECT
    repository_path AS repositoryPath,
    workspace_id AS workspaceId,
    grant_id AS grantId,
    status,
    owner_id AS ownerId,
    execution_id AS executionId,
    lock_token AS lockToken,
    lease_expires_at AS leaseExpiresAt,
    acquired_at AS acquiredAt,
    updated_at AS updatedAt
  FROM git_workspace_locks
`;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new WorkspaceServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function validateTimestamp(value: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new WorkspaceServiceError("VALIDATION_ERROR", "Invalid workspace timestamp");
  }
  return value;
}

function addMilliseconds(timestamp: string, milliseconds: number) {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) {
    throw new WorkspaceServiceError("VALIDATION_ERROR", "Invalid workspace timestamp");
  }
  return new Date(time + milliseconds).toISOString();
}

function normalizeLeaseDuration(value: number | undefined, fallback: number) {
  const duration = value ?? fallback;
  if (!Number.isInteger(duration) || duration < 1 || duration > 30 * 60 * 1000) {
    throw new WorkspaceServiceError(
      "VALIDATION_ERROR",
      "leaseDurationMs must be between 1 ms and 30 minutes",
    );
  }
  return duration;
}

function assertAuthorizedWorkspacePath(repositoryPath: string) {
  try {
    const repositoryStats = lstatSync(repositoryPath);
    const gitStats = lstatSync(join(repositoryPath, ".git"));
    if (
      repositoryStats.isSymbolicLink() ||
      !repositoryStats.isDirectory() ||
      gitStats.isSymbolicLink() ||
      !gitStats.isDirectory() ||
      realpathSync(repositoryPath) !== repositoryPath
    ) {
      throw new Error("workspace path changed");
    }
  } catch {
    throw new WorkspaceServiceError(
      "CONFLICT",
      "Linked repository is no longer an authorized workspace",
    );
  }
}

function toWorkspace(row: WorkspaceRow): WorkspaceRecord {
  return { ...row };
}

function toLock(row: LockRow): WorkspaceLockRecord {
  return { ...row };
}

function grantToLock(
  grant: GrantRow,
  status: WorkspaceLockStatus,
): WorkspaceLockRecord {
  return {
    repositoryPath: grant.repositoryPath,
    workspaceId: grant.workspaceId,
    grantId: grant.id,
    status,
    ownerId: grant.ownerId,
    executionId: grant.executionId,
    lockToken: grant.lockToken,
    leaseExpiresAt: grant.leaseExpiresAt,
    acquiredAt: grant.acquiredAt,
    updatedAt: grant.releasedAt ?? grant.acquiredAt,
  };
}

function requestFingerprint(input: AllocateWorkspaceInput, repositoryPath: string) {
  return JSON.stringify({
    id: input.id ?? null,
    projectId: input.projectId,
    ticketId: input.ticketId ?? null,
    repositoryPath,
    strategy: "shared_repository",
  });
}

function lockFingerprint(input: AcquireWorkspaceLockInput, leaseDurationMs: number) {
  return JSON.stringify({
    workspaceId: input.workspaceId,
    ownerId: input.ownerId,
    executionId: input.executionId ?? null,
    leaseDurationMs,
  });
}

export class WorkspaceService {
  private readonly events: EventService;
  private readonly now: () => string;
  private readonly defaultLeaseDurationMs: number;

  constructor(
    private readonly database: DatabaseSync,
    options: WorkspaceServiceOptions = {},
  ) {
    this.events = new EventService(database);
    this.now = options.now ?? (() => new Date().toISOString());
    this.defaultLeaseDurationMs = normalizeLeaseDuration(
      options.defaultLeaseDurationMs,
      30_000,
    );
  }

  allocate(input: AllocateWorkspaceInput): WorkspaceRecord {
    const projectId = requireText(input.projectId, "projectId");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const ticketId = input.ticketId?.trim() || null;
    const correlationId = input.correlationId?.trim() || randomUUID();

    return transaction(this.database, () => {
      const existingRequest = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              workspace_id AS workspaceId,
              project_id AS projectId,
              request_fingerprint AS requestFingerprint
            FROM git_workspace_allocation_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as AllocationRequestRow | undefined;
      if (existingRequest) {
        const existingWorkspace = this.requireWorkspace(existingRequest.workspaceId);
        const fingerprint = requestFingerprint(input, existingWorkspace.repositoryPath);
        if (existingRequest.requestFingerprint !== fingerprint) {
          throw new WorkspaceServiceError(
            "CONFLICT",
            "Idempotency key was already used for another workspace allocation",
          );
        }
        return existingWorkspace;
      }

      const project = this.database
        .prepare(
          `
            SELECT id, status, repository_path AS repositoryPath
            FROM projects
            WHERE id = ?
          `,
        )
        .get(projectId) as
        | { id: string; status: "active" | "archived"; repositoryPath: string | null }
        | undefined;
      if (!project) throw new WorkspaceServiceError("NOT_FOUND", "Project not found");
      if (project.status !== "active") {
        throw new WorkspaceServiceError(
          "FORBIDDEN",
          "Archived projects are not mutable",
        );
      }
      if (!project.repositoryPath) {
        throw new WorkspaceServiceError("CONFLICT", "Project has no repository linked");
      }
      assertAuthorizedWorkspacePath(project.repositoryPath);

      if (ticketId) {
        const ticket = this.database
          .prepare("SELECT project_id AS projectId FROM tickets WHERE id = ?")
          .get(ticketId) as { projectId: string } | undefined;
        if (!ticket) throw new WorkspaceServiceError("NOT_FOUND", "Ticket not found");
        if (ticket.projectId !== projectId) {
          throw new WorkspaceServiceError(
            "CONFLICT",
            "Ticket belongs to another project",
          );
        }
      }

      const id = requireText(input.id ?? `ws_${randomUUID()}`, "id");
      const workspace = {
        id,
        projectId,
        ticketId,
        repositoryPath: project.repositoryPath,
        workspacePath: project.repositoryPath,
        strategy: "shared_repository" as const,
        status: "active" as const,
      };
      this.database
        .prepare(
          `
            INSERT INTO git_workspaces
              (id, project_id, ticket_id, repository_path, workspace_path, strategy, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          workspace.id,
          workspace.projectId,
          workspace.ticketId,
          workspace.repositoryPath,
          workspace.workspacePath,
          workspace.strategy,
          workspace.status,
        );

      this.database
        .prepare(
          `
            INSERT INTO git_workspace_allocation_requests
              (idempotency_key, workspace_id, project_id, request_fingerprint)
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(
          idempotencyKey,
          workspace.id,
          projectId,
          requestFingerprint(input, workspace.repositoryPath),
        );

      const result = this.requireWorkspace(workspace.id);
      if (input.actor) {
        this.events.recordEvent({
          type: "workspace.allocated",
          version: 1,
          projectId,
          actor: input.actor,
          correlationId,
          payload: {
            workspaceId: result.id,
            ticketId: result.ticketId,
            strategy: result.strategy,
          },
        });
      }
      return result;
    });
  }

  getWorkspace(workspaceId: string) {
    return this.findWorkspace(requireText(workspaceId, "workspaceId"));
  }

  assertLockHeld(workspaceIdInput: string, lockTokenInput: string, now = this.now()) {
    const workspaceId = requireText(workspaceIdInput, "workspaceId");
    const lockToken = requireText(lockTokenInput, "lockToken");
    const timestamp = validateTimestamp(now);
    const workspace = this.requireWorkspace(workspaceId);
    const lock = this.requireLock(workspace.repositoryPath);
    if (workspace.status !== "active" || lock.status !== "held") {
      throw new WorkspaceServiceError("CONFLICT", "Workspace lock is not held");
    }
    if (lock.lockToken !== lockToken) {
      throw new WorkspaceServiceError(
        "LEASE_LOST",
        "Workspace lock is not owned by caller",
      );
    }
    if (lock.leaseExpiresAt <= timestamp) {
      throw new WorkspaceServiceError("LEASE_LOST", "Workspace lock has expired");
    }
    return lock;
  }

  listWorkspaces(projectId: string, includeRetired = false) {
    const id = requireText(projectId, "projectId");
    const conditions = ["project_id = ?"];
    const parameters: (string | number)[] = [id];
    if (!includeRetired) {
      conditions.push("status = 'active'");
    }
    return (
      this.database
        .prepare(
          `${WORKSPACE_SELECT}
           WHERE ${conditions.join(" AND ")}
           ORDER BY created_at, id`,
        )
        .all(...parameters) as WorkspaceRow[]
    ).map(toWorkspace);
  }

  retire(
    workspaceId: string,
    actor?: EventActor,
    correlationId?: string,
    now = this.now(),
  ) {
    const id = requireText(workspaceId, "workspaceId");
    const timestamp = validateTimestamp(now);
    return transaction(this.database, () => {
      const workspace = this.requireWorkspace(id);
      if (workspace.status === "retired") return workspace;
      const lock = this.database
        .prepare(
          `${LOCK_SELECT} WHERE workspace_id = ? AND status IN ('held', 'reconciliation_required')`,
        )
        .get(id) as LockRow | undefined;
      if (lock) {
        throw new WorkspaceServiceError(
          "CONFLICT",
          "Workspace cannot be retired while its lock is held",
        );
      }
      this.database
        .prepare(
          "UPDATE git_workspaces SET status = 'retired', retired_at = ? WHERE id = ?",
        )
        .run(timestamp, id);
      const retired = this.requireWorkspace(id);
      if (actor) {
        this.events.recordEvent({
          type: "workspace.retired",
          version: 1,
          projectId: retired.projectId,
          actor,
          correlationId: correlationId?.trim() || randomUUID(),
          payload: { workspaceId: retired.id, dataDeletion: false },
        });
      }
      return retired;
    });
  }

  acquireLock(input: AcquireWorkspaceLockInput): WorkspaceLockRecord {
    const workspaceId = requireText(input.workspaceId, "workspaceId");
    const ownerId = requireText(input.ownerId, "ownerId");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const leaseDurationMs = normalizeLeaseDuration(
      input.leaseDurationMs,
      this.defaultLeaseDurationMs,
    );
    const timestamp = validateTimestamp(input.now ?? this.now());
    const correlationId = input.correlationId?.trim() || randomUUID();

    const result = transaction(this.database, () => {
      const existingGrant = this.database
        .prepare(
          `
            SELECT
              id,
              idempotency_key AS idempotencyKey,
              workspace_id AS workspaceId,
              repository_path AS repositoryPath,
              owner_id AS ownerId,
              execution_id AS executionId,
              lock_token AS lockToken,
              lease_expires_at AS leaseExpiresAt,
              acquired_at AS acquiredAt,
              released_at AS releasedAt,
              request_fingerprint AS requestFingerprint
            FROM git_workspace_lock_grants
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as GrantRow | undefined;
      if (existingGrant) {
        if (
          existingGrant.requestFingerprint !== lockFingerprint(input, leaseDurationMs)
        ) {
          throw new WorkspaceServiceError(
            "CONFLICT",
            "Idempotency key was already used for another workspace lock",
          );
        }
        const current = this.database
          .prepare(`${LOCK_SELECT} WHERE grant_id = ?`)
          .get(existingGrant.id) as LockRow | undefined;
        return {
          kind: "record" as const,
          record: grantToLock(
            existingGrant,
            current?.status ?? (existingGrant.releasedAt ? "released" : "released"),
          ),
        };
      }

      const workspace = this.requireWorkspace(workspaceId);
      if (workspace.status !== "active") {
        throw new WorkspaceServiceError("FORBIDDEN", "Workspace is retired");
      }
      assertAuthorizedWorkspacePath(workspace.repositoryPath);
      const executionId = input.executionId?.trim() || null;
      if (executionId) {
        const execution = this.database
          .prepare(
            `
              SELECT
                project_id AS projectId,
                requested_workspace_id AS requestedWorkspaceId,
                state
              FROM executions
              WHERE id = ?
            `,
          )
          .get(executionId) as
          | {
              projectId: string;
              requestedWorkspaceId: string | null;
              state: string;
            }
          | undefined;
        if (!execution) {
          throw new WorkspaceServiceError("NOT_FOUND", "Execution not found");
        }
        if (execution.projectId !== workspace.projectId) {
          throw new WorkspaceServiceError(
            "CONFLICT",
            "Execution belongs to another project",
          );
        }
        if (
          execution.requestedWorkspaceId &&
          execution.requestedWorkspaceId !== workspace.id
        ) {
          throw new WorkspaceServiceError(
            "CONFLICT",
            "Execution requested another workspace",
          );
        }
        if (!["queued", "running", "awaiting_approval"].includes(execution.state)) {
          throw new WorkspaceServiceError("CONFLICT", "Execution is not active");
        }
      }
      const current = this.database
        .prepare(`${LOCK_SELECT} WHERE repository_path = ?`)
        .get(workspace.repositoryPath) as LockRow | undefined;
      if (current?.status === "held") {
        if (current.leaseExpiresAt <= timestamp) {
          this.database
            .prepare(
              `
                UPDATE git_workspace_locks
                SET status = 'reconciliation_required', updated_at = ?
                WHERE repository_path = ? AND status = 'held'
              `,
            )
            .run(timestamp, workspace.repositoryPath);
          this.recordLockEvent(
            "workspace.lock_reconciliation_required",
            workspace,
            input,
            correlationId,
            { workspaceId, reason: "lease_expired" },
          );
          return { kind: "reconciliation_required" as const };
        }
        throw new WorkspaceServiceError(
          "CONFLICT",
          "Workspace is already locked by another writer",
        );
      }
      if (current?.status === "reconciliation_required") {
        throw new WorkspaceServiceError(
          "CONFLICT",
          "Workspace requires explicit lock reconciliation",
        );
      }

      const grantId = `lock_${randomUUID()}`;
      const lockToken = randomUUID();
      const leaseExpiresAt = addMilliseconds(timestamp, leaseDurationMs);
      this.database
        .prepare(
          `
            INSERT INTO git_workspace_lock_grants
              (id, idempotency_key, workspace_id, repository_path, owner_id,
               execution_id, lock_token, lease_expires_at, acquired_at,
               request_fingerprint)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          grantId,
          idempotencyKey,
          workspace.id,
          workspace.repositoryPath,
          ownerId,
          executionId,
          lockToken,
          leaseExpiresAt,
          timestamp,
          lockFingerprint(input, leaseDurationMs),
        );
      this.database
        .prepare(
          `
            INSERT INTO git_workspace_locks
              (repository_path, workspace_id, grant_id, status, owner_id,
               execution_id, lock_token, lease_expires_at, acquired_at, updated_at)
            VALUES (?, ?, ?, 'held', ?, ?, ?, ?, ?, ?)
            ON CONFLICT(repository_path) DO UPDATE SET
              workspace_id = excluded.workspace_id,
              grant_id = excluded.grant_id,
              status = 'held',
              owner_id = excluded.owner_id,
              execution_id = excluded.execution_id,
              lock_token = excluded.lock_token,
              lease_expires_at = excluded.lease_expires_at,
              acquired_at = excluded.acquired_at,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          workspace.repositoryPath,
          workspace.id,
          grantId,
          ownerId,
          executionId,
          lockToken,
          leaseExpiresAt,
          timestamp,
          timestamp,
        );
      const lock = this.requireLock(workspace.repositoryPath);
      this.recordLockEvent("workspace.lock_acquired", workspace, input, correlationId, {
        workspaceId,
        executionId,
      });
      return { kind: "record" as const, record: lock };
    });

    if (result.kind === "reconciliation_required") {
      throw new WorkspaceServiceError(
        "LEASE_LOST",
        "Workspace lease expired and requires explicit reconciliation",
      );
    }
    return result.record;
  }

  releaseLock(input: ReleaseWorkspaceLockInput): WorkspaceLockRecord {
    const workspaceId = requireText(input.workspaceId, "workspaceId");
    const ownerId = requireText(input.ownerId, "ownerId");
    const lockToken = requireText(input.lockToken, "lockToken");
    const timestamp = validateTimestamp(input.now ?? this.now());
    const correlationId = input.correlationId?.trim() || randomUUID();
    const result = transaction(this.database, () => {
      const workspace = this.requireWorkspace(workspaceId);
      const lock = this.requireLock(workspace.repositoryPath);
      if (lock.status === "released") return { kind: "record" as const, record: lock };
      if (lock.status === "reconciliation_required") {
        throw new WorkspaceServiceError(
          "CONFLICT",
          "Workspace requires explicit lock reconciliation",
        );
      }
      if (lock.ownerId !== ownerId || lock.lockToken !== lockToken) {
        throw new WorkspaceServiceError(
          "LEASE_LOST",
          "Workspace lock is not owned by caller",
        );
      }
      if (lock.leaseExpiresAt <= timestamp) {
        this.database
          .prepare(
            "UPDATE git_workspace_locks SET status = 'reconciliation_required', updated_at = ? WHERE repository_path = ?",
          )
          .run(timestamp, workspace.repositoryPath);
        this.recordLockEvent(
          "workspace.lock_reconciliation_required",
          workspace,
          input,
          correlationId,
          { workspaceId, reason: "release_after_expiration" },
        );
        return { kind: "reconciliation_required" as const };
      }
      this.database
        .prepare(
          "UPDATE git_workspace_locks SET status = 'released', updated_at = ? WHERE repository_path = ? AND status = 'held'",
        )
        .run(timestamp, workspace.repositoryPath);
      this.database
        .prepare("UPDATE git_workspace_lock_grants SET released_at = ? WHERE id = ?")
        .run(timestamp, lock.grantId);
      const released = this.requireLock(workspace.repositoryPath);
      this.recordLockEvent("workspace.lock_released", workspace, input, correlationId, {
        workspaceId,
      });
      return { kind: "record" as const, record: released };
    });
    if (result.kind === "reconciliation_required") {
      throw new WorkspaceServiceError(
        "LEASE_LOST",
        "Workspace lease expired and requires explicit reconciliation",
      );
    }
    return result.record;
  }

  reconcileLock(input: ReconcileWorkspaceLockInput): WorkspaceLockRecord {
    const workspaceId = requireText(input.workspaceId, "workspaceId");
    const reason = requireText(input.reason, "reason");
    const timestamp = validateTimestamp(input.now ?? this.now());
    const correlationId = input.correlationId?.trim() || randomUUID();
    if (input.actor.type !== "human") {
      throw new WorkspaceServiceError(
        "FORBIDDEN",
        "Human reconciliation is required for an uncertain workspace lock",
      );
    }
    return transaction(this.database, () => {
      const workspace = this.requireWorkspace(workspaceId);
      const lock = this.requireLock(workspace.repositoryPath);
      if (lock.status === "released") return lock;
      if (lock.status !== "reconciliation_required") {
        throw new WorkspaceServiceError(
          "CONFLICT",
          "Only an uncertain workspace lock can be reconciled",
        );
      }
      this.database
        .prepare(
          "UPDATE git_workspace_locks SET status = 'released', updated_at = ? WHERE repository_path = ?",
        )
        .run(timestamp, workspace.repositoryPath);
      this.database
        .prepare(
          "UPDATE git_workspace_lock_grants SET released_at = COALESCE(released_at, ?) WHERE id = ?",
        )
        .run(timestamp, lock.grantId);
      const reconciled = this.requireLock(workspace.repositoryPath);
      this.events.recordEvent({
        type: "workspace.lock_reconciled",
        version: 1,
        projectId: workspace.projectId,
        actor: input.actor,
        correlationId,
        payload: { workspaceId, reason },
      });
      return reconciled;
    });
  }

  private recordLockEvent(
    type: string,
    workspace: WorkspaceRecord,
    input: {
      actor?: EventActor;
      correlationId?: string;
    },
    correlationId: string,
    payload: Record<string, unknown>,
  ) {
    if (!input.actor) return;
    this.events.recordEvent({
      type,
      version: 1,
      projectId: workspace.projectId,
      actor: input.actor,
      correlationId,
      payload,
    });
  }

  private findWorkspace(workspaceId: string) {
    const row = this.database
      .prepare(`${WORKSPACE_SELECT} WHERE id = ?`)
      .get(workspaceId) as WorkspaceRow | undefined;
    return row ? toWorkspace(row) : undefined;
  }

  private requireWorkspace(workspaceId: string) {
    const workspace = this.findWorkspace(workspaceId);
    if (!workspace) throw new WorkspaceServiceError("NOT_FOUND", "Workspace not found");
    return workspace;
  }

  private requireLock(repositoryPath: string) {
    const lock = this.database
      .prepare(`${LOCK_SELECT} WHERE repository_path = ?`)
      .get(repositoryPath) as LockRow | undefined;
    if (!lock) throw new WorkspaceServiceError("NOT_FOUND", "Workspace lock not found");
    return toLock(lock);
  }
}
