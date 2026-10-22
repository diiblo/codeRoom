import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { EventService, type EventActor } from "../events/service.js";

export const EXECUTION_STATES = [
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

export type EnqueueExecutionInput = {
  id?: string;
  projectId: string;
  assignmentId: string;
  triggerId: string;
  instruction: string;
  contextRefs: readonly string[];
  requestedWorkspaceId?: string;
  idempotencyKey: string;
  parentExecutionId?: string;
  actor?: EventActor;
};

export type ExecutionRecord = {
  id: string;
  projectId: string;
  assignmentId: string;
  triggerId: string;
  idempotencyKey: string;
  instruction: string;
  contextRefs: string[];
  requestedWorkspaceId: string | null;
  parentExecutionId: string | null;
  state: ExecutionState;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionTransition = {
  id: string;
  executionId: string;
  fromState: ExecutionState | null;
  toState: ExecutionState;
  reason: string;
  createdAt: string;
};

export type ExecutionSession = {
  id: string;
  executionId: string;
  projectId: string;
  assignmentId: string;
  status: ExecutionSessionStatus;
  contextScope: SessionContextScope;
  provider: string;
  providerSessionKey: string | null;
  providerVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export const EXECUTION_SESSION_STATUSES = ["active", "revoked"] as const;
export type ExecutionSessionStatus = (typeof EXECUTION_SESSION_STATUSES)[number];

export type SessionContextScope = {
  projectId: string;
  assignmentId: string;
};

export type CreateExecutionSessionInput = {
  id?: string;
  executionId: string;
  provider: string;
  providerSessionKey?: string;
  providerVersion?: string;
};

export type TransitionExecutionOptions = {
  workerId?: string;
  reason?: string;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
  actor?: EventActor;
  now?: string;
};

export type CancelExecutionOptions = {
  workerId?: string;
  reason?: string;
  actor?: EventActor;
  now?: string;
};

export type CancelExecutionResult = {
  execution: ExecutionRecord;
  status: "cancelled" | "requested" | "already-finished";
  changed: boolean;
};

export type ExecutionServiceOptions = {
  now?: () => string;
  leaseDurationMs?: number;
};

export class ExecutionServiceError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "CONFLICT"
      | "INVALID_TRANSITION"
      | "LEASE_REQUIRED"
      | "LEASE_LOST",
    message: string,
  ) {
    super(message);
    this.name = "ExecutionServiceError";
  }
}

type ExecutionRow = {
  id: string;
  projectId: string;
  assignmentId: string;
  triggerId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  instruction: string;
  contextRefs: string;
  requestedWorkspaceId: string | null;
  parentExecutionId: string | null;
  state: ExecutionState;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  cancelRequestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  result: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type TransitionRow = {
  id: string;
  executionId: string;
  fromState: ExecutionState | null;
  toState: ExecutionState;
  reason: string;
  createdAt: string;
};

type SessionRow = {
  id: string;
  executionId: string;
  projectId: string;
  assignmentId: string;
  status: ExecutionSessionStatus;
  contextScope: string;
  provider: string;
  providerSessionKey: string | null;
  providerVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

const TERMINAL_STATES = new Set<ExecutionState>([
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

const ALLOWED_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = {
  queued: ["running", "cancelled"],
  running: ["awaiting_approval", "succeeded", "failed", "cancelled", "unknown"],
  awaiting_approval: ["running", "cancelled", "unknown"],
  succeeded: [],
  failed: [],
  cancelled: [],
  unknown: [],
};

const EXECUTION_SELECT = `
  SELECT
    id,
    project_id AS projectId,
    assignment_id AS assignmentId,
    trigger_id AS triggerId,
    idempotency_key AS idempotencyKey,
    request_fingerprint AS requestFingerprint,
    instruction,
    context_refs AS contextRefs,
    requested_workspace_id AS requestedWorkspaceId,
    parent_execution_id AS parentExecutionId,
    state,
    lease_owner AS leaseOwner,
    lease_expires_at AS leaseExpiresAt,
    cancel_requested_at AS cancelRequestedAt,
    started_at AS startedAt,
    finished_at AS finishedAt,
    result,
    error_code AS errorCode,
    error_message AS errorMessage,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM executions
`;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ExecutionServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function requireLeaseOwner(value: string | undefined) {
  if (!value?.trim()) {
    throw new ExecutionServiceError("LEASE_REQUIRED", "Worker lease is required");
  }
  return value.trim();
}

function normalizeContextRefs(contextRefs: readonly string[]) {
  if (!Array.isArray(contextRefs)) {
    throw new ExecutionServiceError("VALIDATION_ERROR", "contextRefs must be an array");
  }
  return contextRefs.map((contextRef, index) => {
    if (typeof contextRef !== "string" || !contextRef.trim()) {
      throw new ExecutionServiceError(
        "VALIDATION_ERROR",
        `contextRefs[${index}] must be a non-empty string`,
      );
    }
    return contextRef.trim();
  });
}

function parseObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseStringArray(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function toExecution(row: ExecutionRow): ExecutionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    assignmentId: row.assignmentId,
    triggerId: row.triggerId,
    idempotencyKey: row.idempotencyKey,
    instruction: row.instruction,
    contextRefs: parseStringArray(row.contextRefs),
    requestedWorkspaceId: row.requestedWorkspaceId,
    parentExecutionId: row.parentExecutionId,
    state: row.state,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    cancelRequestedAt: row.cancelRequestedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    result: parseObject(row.result),
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTransition(row: TransitionRow): ExecutionTransition {
  return {
    id: row.id,
    executionId: row.executionId,
    fromState: row.fromState,
    toState: row.toState,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function toSession(row: SessionRow): ExecutionSession {
  let contextScope: SessionContextScope = {
    projectId: row.projectId,
    assignmentId: row.assignmentId,
  };
  try {
    const parsed: unknown = JSON.parse(row.contextScope);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { projectId?: unknown }).projectId === "string" &&
      typeof (parsed as { assignmentId?: unknown }).assignmentId === "string"
    ) {
      contextScope = {
        projectId: (parsed as { projectId: string }).projectId,
        assignmentId: (parsed as { assignmentId: string }).assignmentId,
      };
    }
  } catch {
    // Older rows fall back to the relational scope stored with the session.
  }
  return {
    id: row.id,
    executionId: row.executionId,
    projectId: row.projectId,
    assignmentId: row.assignmentId,
    status: row.status,
    contextScope,
    provider: row.provider,
    providerSessionKey: row.providerSessionKey,
    providerVersion: row.providerVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function validateTimestamp(value: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new ExecutionServiceError("VALIDATION_ERROR", "Invalid execution timestamp");
  }
  return value;
}

function addMilliseconds(timestamp: string, milliseconds: number) {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) {
    throw new ExecutionServiceError("VALIDATION_ERROR", "Invalid execution timestamp");
  }
  return new Date(time + milliseconds).toISOString();
}

function sameFingerprint(left: string, right: string) {
  return left === right;
}

export class ExecutionService {
  private readonly eventService: EventService;
  private readonly now: () => string;
  private readonly leaseDurationMs: number;

  constructor(
    private readonly database: DatabaseSync,
    options: ExecutionServiceOptions = {},
  ) {
    this.eventService = new EventService(database);
    this.now = options.now ?? (() => new Date().toISOString());
    this.leaseDurationMs = options.leaseDurationMs ?? 30_000;
    if (!Number.isInteger(this.leaseDurationMs) || this.leaseDurationMs < 1) {
      throw new ExecutionServiceError(
        "VALIDATION_ERROR",
        "leaseDurationMs must be a positive integer",
      );
    }
  }

  enqueue(input: EnqueueExecutionInput): ExecutionRecord {
    return transaction(this.database, () => this.enqueueWithinTransaction(input));
  }

  /**
   * Enqueues an execution while the caller owns the current transaction.
   * Routing uses this to persist the mention intention and execution atomically.
   */
  enqueueWithinTransaction(input: EnqueueExecutionInput): ExecutionRecord {
    const projectId = requireText(input.projectId, "projectId");
    const assignmentId = requireText(input.assignmentId, "assignmentId");
    const triggerId = requireText(input.triggerId, "triggerId");
    const instruction = requireText(input.instruction, "instruction");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const contextRefs = normalizeContextRefs(input.contextRefs);
    const requestedWorkspaceId = input.requestedWorkspaceId?.trim() || null;
    const parentExecutionId = input.parentExecutionId?.trim() || null;
    const fingerprint = JSON.stringify({
      projectId,
      assignmentId,
      triggerId,
      instruction,
      contextRefs,
      requestedWorkspaceId,
      parentExecutionId,
    });
    const now = validateTimestamp(this.now());

    const existingByIdempotency = this.findExecutionBy(
      "project_id = ? AND idempotency_key = ?",
      [projectId, idempotencyKey],
    );
    if (existingByIdempotency) {
      if (!sameFingerprint(existingByIdempotency.requestFingerprint, fingerprint)) {
        throw new ExecutionServiceError(
          "CONFLICT",
          "Idempotency key was already used with another execution request",
        );
      }
      return toExecution(existingByIdempotency);
    }

    const existingByTrigger = this.findExecutionBy(
      "project_id = ? AND trigger_id = ?",
      [projectId, triggerId],
    );
    if (existingByTrigger) {
      if (!sameFingerprint(existingByTrigger.requestFingerprint, fingerprint)) {
        throw new ExecutionServiceError(
          "CONFLICT",
          "Trigger was already used with another execution request",
        );
      }
      return toExecution(existingByTrigger);
    }

    if (parentExecutionId) {
      const parent = this.findExecutionBy("id = ?", [parentExecutionId]);
      if (!parent) {
        throw new ExecutionServiceError("NOT_FOUND", "Parent execution not found");
      }
      if (parent.projectId !== projectId) {
        throw new ExecutionServiceError(
          "CONFLICT",
          "Parent execution belongs to another project",
        );
      }
    }

    const assignment = this.database
      .prepare("SELECT project_id AS projectId, status FROM assignments WHERE id = ?")
      .get(assignmentId) as { projectId: string; status: string } | undefined;
    if (!assignment) {
      throw new ExecutionServiceError("NOT_FOUND", "Assignment not found");
    }
    if (assignment.projectId !== projectId) {
      throw new ExecutionServiceError(
        "CONFLICT",
        "Assignment belongs to another project",
      );
    }
    if (assignment.status !== "active") {
      throw new ExecutionServiceError("CONFLICT", "Assignment is not active");
    }

    const id = requireText(input.id ?? randomUUID(), "id");
    const active = this.findExecutionBy(
      "assignment_id = ? AND state IN ('queued', 'running', 'awaiting_approval')",
      [assignmentId],
    );
    if (active) {
      throw new ExecutionServiceError(
        "CONFLICT",
        "Assignment already has an active execution",
      );
    }

    this.database
      .prepare(
        `
          INSERT INTO executions
            (id, project_id, assignment_id, trigger_id, idempotency_key,
             request_fingerprint, instruction, context_refs,
             requested_workspace_id, parent_execution_id, state,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `,
      )
      .run(
        id,
        projectId,
        assignmentId,
        triggerId,
        idempotencyKey,
        fingerprint,
        instruction,
        JSON.stringify(contextRefs),
        requestedWorkspaceId,
        parentExecutionId,
        now,
        now,
      );

    const execution = this.requireExecution(id);
    this.recordTransition(execution, null, "queued", "enqueued", now, input.actor);
    return execution;
  }

  getExecution(executionId: string) {
    const row = this.findExecutionBy("id = ?", [
      requireText(executionId, "executionId"),
    ]);
    return row ? toExecution(row) : undefined;
  }

  requireExecution(executionId: string) {
    const execution = this.getExecution(executionId);
    if (!execution) {
      throw new ExecutionServiceError("NOT_FOUND", "Execution not found");
    }
    return execution;
  }

  listExecutions(projectId?: string) {
    const conditions = ["1 = 1"];
    const parameters: string[] = [];
    if (projectId !== undefined) {
      conditions.push("project_id = ?");
      parameters.push(requireText(projectId, "projectId"));
    }
    return (
      this.database
        .prepare(
          `${EXECUTION_SELECT}
           WHERE ${conditions.join(" AND ")}
           ORDER BY created_at DESC, id DESC`,
        )
        .all(...parameters) as ExecutionRow[]
    ).map(toExecution);
  }

  listTransitions(executionId: string) {
    const id = requireText(executionId, "executionId");
    return (
      this.database
        .prepare(
          `
            SELECT
              id,
              execution_id AS executionId,
              from_state AS fromState,
              to_state AS toState,
              reason,
              created_at AS createdAt
            FROM execution_transitions
            WHERE execution_id = ?
            ORDER BY rowid ASC
          `,
        )
        .all(id) as TransitionRow[]
    ).map(toTransition);
  }

  reserveNext(workerId: string, now = this.now()) {
    const owner = requireText(workerId, "workerId");
    const timestamp = validateTimestamp(now);
    return transaction(this.database, () => {
      const row = this.database
        .prepare(
          `${EXECUTION_SELECT} WHERE state = 'queued' ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get() as ExecutionRow | undefined;
      if (!row) return undefined;
      return this.applyTransition(
        toExecution(row),
        "running",
        { workerId: owner, reason: "lease_acquired" },
        timestamp,
      );
    });
  }

  renewLease(executionId: string, workerId: string, now = this.now()) {
    const id = requireText(executionId, "executionId");
    const owner = requireText(workerId, "workerId");
    const timestamp = validateTimestamp(now);
    return transaction(this.database, () => {
      const execution = this.requireExecution(id);
      this.assertLease(execution, owner, timestamp);
      const leaseExpiresAt = addMilliseconds(timestamp, this.leaseDurationMs);
      this.database
        .prepare(
          "UPDATE executions SET lease_expires_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(leaseExpiresAt, timestamp, id);
      return this.requireExecution(id);
    });
  }

  transition(
    executionId: string,
    nextState: ExecutionState,
    options: TransitionExecutionOptions = {},
  ) {
    const id = requireText(executionId, "executionId");
    if (!EXECUTION_STATES.includes(nextState)) {
      throw new ExecutionServiceError("VALIDATION_ERROR", "Unknown execution state");
    }
    const timestamp = validateTimestamp(options.now ?? this.now());
    return transaction(this.database, () => {
      return this.transitionWithinTransaction(id, nextState, {
        ...options,
        now: timestamp,
      });
    });
  }

  /**
   * Applies a state transition while the caller owns the current transaction.
   * Approval resolution uses this to keep the approval and execution changes
   * atomic.
   */
  transitionWithinTransaction(
    executionId: string,
    nextState: ExecutionState,
    options: TransitionExecutionOptions = {},
  ) {
    const id = requireText(executionId, "executionId");
    if (!EXECUTION_STATES.includes(nextState)) {
      throw new ExecutionServiceError("VALIDATION_ERROR", "Unknown execution state");
    }
    const timestamp = validateTimestamp(options.now ?? this.now());
    const execution = this.requireExecution(id);
    if (execution.state === nextState) return execution;
    return this.applyTransition(execution, nextState, options, timestamp);
  }

  /**
   * Cancels an approval-paused execution from the server reconciliation path.
   * It deliberately does not require the expired worker lease: once an
   * approval is refused or invalidated, keeping the execution paused is safer
   * than allowing an old worker to resume it.
   */
  cancelAwaitingApprovalWithinTransaction(
    executionId: string,
    options: { reason?: string; actor?: EventActor; now?: string } = {},
  ) {
    const id = requireText(executionId, "executionId");
    const timestamp = validateTimestamp(options.now ?? this.now());
    const execution = this.requireExecution(id);
    if (execution.state !== "awaiting_approval") return execution;

    this.database
      .prepare(
        `
          UPDATE executions
          SET state = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
              finished_at = ?, updated_at = ?
          WHERE id = ? AND state = 'awaiting_approval'
        `,
      )
      .run(timestamp, timestamp, id);
    const cancelled = this.requireExecution(id);
    this.recordTransition(
      cancelled,
      "awaiting_approval",
      "cancelled",
      options.reason ?? "approval_refused",
      timestamp,
      options.actor,
    );
    return cancelled;
  }

  cancel(
    executionId: string,
    options: CancelExecutionOptions = {},
  ): CancelExecutionResult {
    const id = requireText(executionId, "executionId");
    const timestamp = validateTimestamp(options.now ?? this.now());
    return transaction(this.database, () => {
      const execution = this.requireExecution(id);
      if (TERMINAL_STATES.has(execution.state)) {
        return { execution, status: "already-finished", changed: false };
      }
      if (execution.state === "queued") {
        const cancelled = this.applyTransition(
          execution,
          "cancelled",
          {
            reason: options.reason ?? "cancelled_before_reservation",
            actor: options.actor,
          },
          timestamp,
        );
        return { execution: cancelled, status: "cancelled", changed: true };
      }
      if (options.workerId) {
        const cancelled = this.applyTransition(
          execution,
          "cancelled",
          {
            workerId: options.workerId,
            reason: options.reason ?? "cancelled",
            actor: options.actor,
          },
          timestamp,
        );
        return { execution: cancelled, status: "cancelled", changed: true };
      }

      const changed = execution.cancelRequestedAt === null;
      if (changed) {
        this.database
          .prepare(
            "UPDATE executions SET cancel_requested_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(timestamp, timestamp, id);
        this.eventService.recordEvent({
          type: "execution.cancel_requested",
          version: 1,
          projectId: execution.projectId,
          actor: options.actor ?? { type: "system", id: "coderoom" },
          correlationId: execution.id,
          createdAt: timestamp,
          payload: { executionId: execution.id, state: execution.state },
        });
      }
      return {
        execution: this.requireExecution(id),
        status: "requested",
        changed,
      };
    });
  }

  reconcileAfterRestart(now = this.now()) {
    const timestamp = validateTimestamp(now);
    return transaction(this.database, () => {
      const rows = this.database
        .prepare(
          `${EXECUTION_SELECT} WHERE state IN ('running', 'awaiting_approval') ORDER BY created_at ASC, id ASC`,
        )
        .all() as ExecutionRow[];
      return rows.map((row) =>
        this.markUnknown(toExecution(row), "process_restart_reconciliation", timestamp),
      );
    });
  }

  reconcileExpiredLeases(now = this.now()) {
    const timestamp = validateTimestamp(now);
    return transaction(this.database, () => {
      const rows = this.database
        .prepare(
          `${EXECUTION_SELECT}
           WHERE state IN ('running', 'awaiting_approval')
             AND lease_expires_at IS NOT NULL
             AND lease_expires_at <= ?
           ORDER BY created_at ASC, id ASC`,
        )
        .all(timestamp) as ExecutionRow[];
      return rows.map((row) =>
        this.markUnknown(toExecution(row), "lease_expired_reconciliation", timestamp),
      );
    });
  }

  createSession(input: CreateExecutionSessionInput) {
    const executionId = requireText(input.executionId, "executionId");
    const provider = requireText(input.provider, "provider");
    const providerSessionKey = input.providerSessionKey?.trim() || null;
    const providerVersion = input.providerVersion?.trim() || null;
    return transaction(this.database, () => {
      const execution = this.requireExecution(executionId);
      const existing = this.database
        .prepare(
          `
            SELECT
              id,
              execution_id AS executionId,
              project_id AS projectId,
              assignment_id AS assignmentId,
              status,
              context_scope AS contextScope,
              provider,
              provider_session_key AS providerSessionKey,
              provider_version AS providerVersion,
              created_at AS createdAt,
              updated_at AS updatedAt
            FROM execution_sessions
            WHERE execution_id = ?
          `,
        )
        .get(executionId) as SessionRow | undefined;
      if (existing) {
        if (
          existing.provider !== provider ||
          existing.providerSessionKey !== providerSessionKey ||
          existing.providerVersion !== providerVersion
        ) {
          throw new ExecutionServiceError(
            "CONFLICT",
            "Execution session already exists with another provider identity",
          );
        }
        return toSession(existing);
      }

      if (providerSessionKey) {
        const sessionWithKey = this.database
          .prepare(
            `
              SELECT execution_id AS executionId, project_id AS projectId
              FROM execution_sessions
              WHERE provider = ? AND provider_session_key = ?
            `,
          )
          .get(provider, providerSessionKey) as
          { executionId: string; projectId: string } | undefined;
        if (sessionWithKey) {
          throw new ExecutionServiceError(
            "CONFLICT",
            "Provider session key is already attached to another execution",
          );
        }
      }

      const id = requireText(input.id ?? randomUUID(), "sessionId");
      const timestamp = validateTimestamp(this.now());
      this.database
        .prepare(
          `
            INSERT INTO execution_sessions
              (id, execution_id, project_id, assignment_id, status, context_scope,
               provider, provider_session_key, provider_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          id,
          execution.id,
          execution.projectId,
          execution.assignmentId,
          JSON.stringify({
            projectId: execution.projectId,
            assignmentId: execution.assignmentId,
          }),
          provider,
          providerSessionKey,
          providerVersion,
          timestamp,
          timestamp,
        );
      return this.requireSession(id);
    });
  }

  getSession(executionId: string) {
    const id = requireText(executionId, "executionId");
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            execution_id AS executionId,
            project_id AS projectId,
            assignment_id AS assignmentId,
            status,
            context_scope AS contextScope,
            provider,
            provider_session_key AS providerSessionKey,
            provider_version AS providerVersion,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM execution_sessions
          WHERE execution_id = ?
        `,
      )
      .get(id) as SessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  private requireSession(sessionId: string) {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            execution_id AS executionId,
            project_id AS projectId,
            assignment_id AS assignmentId,
            status,
            context_scope AS contextScope,
            provider,
            provider_session_key AS providerSessionKey,
            provider_version AS providerVersion,
            created_at AS createdAt,
            updated_at AS updatedAt
          FROM execution_sessions
          WHERE id = ?
        `,
      )
      .get(sessionId) as SessionRow | undefined;
    if (!row)
      throw new ExecutionServiceError("NOT_FOUND", "Execution session not found");
    return toSession(row);
  }

  private findExecutionBy(condition: string, parameters: readonly (string | number)[]) {
    const row = this.database
      .prepare(`${EXECUTION_SELECT} WHERE ${condition} LIMIT 1`)
      .get(...parameters) as ExecutionRow | undefined;
    return row;
  }

  private assertLease(execution: ExecutionRecord, workerId: string, now: string) {
    if (!execution.leaseOwner || execution.leaseOwner !== workerId) {
      throw new ExecutionServiceError(
        "LEASE_LOST",
        "Execution lease is not owned by worker",
      );
    }
    if (!execution.leaseExpiresAt || execution.leaseExpiresAt <= now) {
      throw new ExecutionServiceError("LEASE_LOST", "Execution lease has expired");
    }
  }

  private applyTransition(
    execution: ExecutionRecord,
    nextState: ExecutionState,
    options: TransitionExecutionOptions,
    now: string,
  ) {
    if (!ALLOWED_TRANSITIONS[execution.state].includes(nextState)) {
      throw new ExecutionServiceError(
        "INVALID_TRANSITION",
        `Cannot transition execution from ${execution.state} to ${nextState}`,
      );
    }

    const needsLease =
      execution.state === "running" || execution.state === "awaiting_approval";
    if (needsLease) {
      const workerId = requireLeaseOwner(options.workerId);
      this.assertLease(execution, workerId, now);
    }
    if (nextState === "running" || nextState === "awaiting_approval") {
      const workerId = requireLeaseOwner(options.workerId);
      if (nextState === "awaiting_approval") this.assertLease(execution, workerId, now);
    }

    const leaseOwner =
      nextState === "running" || nextState === "awaiting_approval"
        ? (options.workerId ?? execution.leaseOwner)
        : null;
    const leaseExpiresAt =
      nextState === "running" || nextState === "awaiting_approval"
        ? addMilliseconds(now, this.leaseDurationMs)
        : null;
    const startedAt = execution.startedAt ?? (nextState === "running" ? now : null);
    const finishedAt = TERMINAL_STATES.has(nextState) ? now : null;
    const result = options.result ?? execution.result;
    const errorCode =
      options.error?.code ?? (nextState === "failed" ? execution.errorCode : null);
    const errorMessage =
      options.error?.message ??
      (nextState === "failed" ? execution.errorMessage : null);

    this.database
      .prepare(
        `
          UPDATE executions
          SET state = ?, lease_owner = ?, lease_expires_at = ?,
              started_at = ?, finished_at = ?, result = ?,
              error_code = ?, error_message = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        nextState,
        leaseOwner,
        leaseExpiresAt,
        startedAt,
        finishedAt,
        JSON.stringify(result),
        errorCode,
        errorMessage,
        now,
        execution.id,
      );

    const updated = this.requireExecution(execution.id);
    this.recordTransition(
      updated,
      execution.state,
      nextState,
      options.reason ?? `${execution.state}_to_${nextState}`,
      now,
      options.actor,
    );
    return updated;
  }

  private markUnknown(execution: ExecutionRecord, reason: string, now: string) {
    this.database
      .prepare(
        `
          UPDATE executions
          SET state = 'unknown', lease_owner = NULL, lease_expires_at = NULL,
              finished_at = ?, error_code = ?, error_message = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        now,
        "EXECUTION_UNCERTAIN",
        "Execution requires reconciliation after an uncertain stop",
        now,
        execution.id,
      );
    const updated = this.requireExecution(execution.id);
    this.recordTransition(updated, execution.state, "unknown", reason, now, undefined);
    return updated;
  }

  private recordTransition(
    execution: ExecutionRecord,
    fromState: ExecutionState | null,
    toState: ExecutionState,
    reason: string,
    createdAt: string,
    actor: EventActor | undefined,
  ) {
    const transitionId = randomUUID();
    this.database
      .prepare(
        `
          INSERT INTO execution_transitions
            (id, execution_id, from_state, to_state, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(transitionId, execution.id, fromState, toState, reason, createdAt);
    this.eventService.recordEvent({
      type: "execution.state_changed",
      version: 1,
      projectId: execution.projectId,
      actor: actor ?? { type: "system", id: "coderoom" },
      correlationId: execution.id,
      createdAt,
      payload: {
        executionId: execution.id,
        fromState,
        toState,
        reason,
      },
    });
  }
}
