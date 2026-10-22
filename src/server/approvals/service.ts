import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { CANONICAL_PERMISSIONS, type Permission } from "../security/authorization.js";
import {
  ExecutionService,
  ExecutionServiceError,
  type ExecutionRecord,
} from "../executions/service.js";
import { EventService, type EventActor } from "../events/service.js";

export const APPROVAL_STATUSES = ["pending", "approved", "denied", "expired"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type ApprovalDecision = "approved" | "denied";

export type ApprovalOwnerIdentity = {
  type: "human" | "agent" | "system";
  id: string;
};

export type ApprovalRecord = {
  id: string;
  actionRequestId: string;
  projectId: string;
  executionId: string;
  assignmentId: string;
  actionType: string;
  requiredPermission: Permission;
  payload: Record<string, unknown>;
  contextFingerprint: string;
  idempotencyKey: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedByType: "human" | "system" | null;
  decidedById: string | null;
  decisionReason: string | null;
};

export type ApprovalOwnerAuthorizationInput = {
  projectId: string;
  identity: ApprovalOwnerIdentity;
  approval: ApprovalRecord;
};

export type ApprovalOwnerAuthorizer = (
  input: ApprovalOwnerAuthorizationInput,
) => boolean;

export type ApprovalServiceOptions = {
  now?: () => string;
  defaultTtlMs?: number;
  ownerAuthorizer?: ApprovalOwnerAuthorizer;
  executionService?: ExecutionService;
};

export type RequestApprovalInput = {
  id?: string;
  actionRequestId?: string;
  executionId: string;
  actionType: string;
  requiredPermission: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  expiresAt?: string;
  now?: string;
};

export type DecideApprovalInput = {
  approvalId: string;
  decision: ApprovalDecision;
  identity: ApprovalOwnerIdentity;
  reason?: string;
  now?: string;
};

export type ListApprovalsInput = {
  projectId?: string;
  status?: ApprovalStatus;
};

export class ApprovalServiceError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN" | "UNAUTHORIZED",
    message: string,
  ) {
    super(message);
    this.name = "ApprovalServiceError";
  }
}

type ApprovalRow = {
  id: string;
  actionRequestId: string;
  projectId: string;
  executionId: string;
  assignmentId: string;
  actionType: string;
  requiredPermission: Permission;
  payload: string;
  contextFingerprint: string;
  idempotencyKey: string;
  status: ApprovalStatus;
  requestedAt: string;
  expiresAt: string;
  decidedAt: string | null;
  decidedByType: "human" | "system" | null;
  decidedById: string | null;
  decisionReason: string | null;
};

type ApprovalContextRow = {
  projectId: string;
  assignmentId: string;
  agentId: string;
  permissionSet: string;
  assignmentStatus: string;
  assignmentArchivedAt: string | null;
  projectStatus: string;
  agentArchivedAt: string | null;
};

const APPROVAL_SELECT = `
  SELECT
    id,
    action_request_id AS actionRequestId,
    project_id AS projectId,
    execution_id AS executionId,
    assignment_id AS assignmentId,
    action_type AS actionType,
    required_permission AS requiredPermission,
    payload,
    context_fingerprint AS contextFingerprint,
    idempotency_key AS idempotencyKey,
    status,
    requested_at AS requestedAt,
    expires_at AS expiresAt,
    decided_at AS decidedAt,
    decided_by_type AS decidedByType,
    decided_by_id AS decidedById,
    decision_reason AS decisionReason
  FROM approvals
`;

const DEFAULT_TTL_MS = 15 * 60 * 1_000;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ApprovalServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function validateTimestamp(value: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new ApprovalServiceError("VALIDATION_ERROR", "Invalid approval timestamp");
  }
  return value;
}

function addMilliseconds(timestamp: string, milliseconds: number) {
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    throw new ApprovalServiceError("VALIDATION_ERROR", "Invalid approval timestamp");
  }
  return new Date(parsed + milliseconds).toISOString();
}

function normalizePayload(payload: Record<string, unknown> | undefined) {
  if (payload === undefined) return {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApprovalServiceError(
      "VALIDATION_ERROR",
      "Approval payload must be an object",
    );
  }
  try {
    JSON.stringify(payload);
  } catch {
    throw new ApprovalServiceError(
      "VALIDATION_ERROR",
      "Approval payload must be JSON serializable",
    );
  }
  return payload;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parsePermissionSet(value: string): Permission[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((permission) => typeof permission !== "string")
    ) {
      return undefined;
    }
    return CANONICAL_PERMISSIONS.filter((permission) => parsed.includes(permission));
  } catch {
    return undefined;
  }
}

function toApproval(row: ApprovalRow): ApprovalRecord {
  return {
    id: row.id,
    actionRequestId: row.actionRequestId,
    projectId: row.projectId,
    executionId: row.executionId,
    assignmentId: row.assignmentId,
    actionType: row.actionType,
    requiredPermission: row.requiredPermission,
    payload: parsePayload(row.payload),
    contextFingerprint: row.contextFingerprint,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    decidedByType: row.decidedByType,
    decidedById: row.decidedById,
    decisionReason: row.decisionReason,
  };
}

function sameRequest(
  left: ApprovalRecord,
  right: {
    actionRequestId: string;
    executionId: string;
    assignmentId: string;
    actionType: string;
    requiredPermission: Permission;
    payload: Record<string, unknown>;
  },
) {
  return (
    left.actionRequestId === right.actionRequestId &&
    left.executionId === right.executionId &&
    left.assignmentId === right.assignmentId &&
    left.actionType === right.actionType &&
    left.requiredPermission === right.requiredPermission &&
    JSON.stringify(left.payload) === JSON.stringify(right.payload)
  );
}

function contextFingerprint(
  context: ApprovalContextRow & { permissionSetParsed: readonly Permission[] },
  input: {
    actionType: string;
    requiredPermission: Permission;
    payload: Record<string, unknown>;
  },
) {
  return JSON.stringify({
    projectId: context.projectId,
    assignmentId: context.assignmentId,
    agentId: context.agentId,
    assignmentStatus: context.assignmentStatus,
    assignmentArchivedAt: context.assignmentArchivedAt,
    projectStatus: context.projectStatus,
    agentArchivedAt: context.agentArchivedAt,
    permissionSet: context.permissionSetParsed,
    actionType: input.actionType,
    requiredPermission: input.requiredPermission,
    payload: input.payload,
  });
}

export class ApprovalService {
  private readonly eventService: EventService;
  private readonly executionService: ExecutionService;
  private readonly now: () => string;
  private readonly defaultTtlMs: number;
  private readonly ownerAuthorizer: ApprovalOwnerAuthorizer;

  constructor(
    private readonly database: DatabaseSync,
    options: ApprovalServiceOptions = {},
  ) {
    this.eventService = new EventService(database);
    this.now = options.now ?? (() => new Date().toISOString());
    this.executionService =
      options.executionService ?? new ExecutionService(database, { now: this.now });
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.ownerAuthorizer = options.ownerAuthorizer ?? (() => false);
    if (!Number.isInteger(this.defaultTtlMs) || this.defaultTtlMs < 1) {
      throw new ApprovalServiceError(
        "VALIDATION_ERROR",
        "defaultTtlMs must be a positive integer",
      );
    }
  }

  requestApproval(input: RequestApprovalInput): ApprovalRecord {
    const executionId = requireText(input.executionId, "executionId");
    const actionType = requireText(input.actionType, "actionType");
    const requiredPermission = this.requirePermission(input.requiredPermission);
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const payload = normalizePayload(input.payload);
    const now = validateTimestamp(input.now ?? this.now());
    const expiresAt = validateTimestamp(
      input.expiresAt ?? addMilliseconds(now, this.defaultTtlMs),
    );
    if (Date.parse(expiresAt) <= Date.parse(now)) {
      throw new ApprovalServiceError(
        "VALIDATION_ERROR",
        "Approval expiration must be after request time",
      );
    }

    return transaction(this.database, () => {
      const execution = this.executionService.requireExecution(executionId);
      const context = this.readContext(execution);
      const actionRequestId = requireText(
        input.actionRequestId ??
          input.id ??
          `approval-request:${executionId}:${idempotencyKey}`,
        "actionRequestId",
      );
      const request = {
        actionRequestId,
        executionId,
        assignmentId: execution.assignmentId,
        actionType,
        requiredPermission,
        payload,
      };
      const existing = this.findBy("project_id = ? AND idempotency_key = ?", [
        execution.projectId,
        idempotencyKey,
      ]);
      if (existing) {
        const existingApproval = toApproval(existing);
        if (!sameRequest(existingApproval, request)) {
          throw new ApprovalServiceError(
            "CONFLICT",
            "Approval idempotency key was already used for another request",
          );
        }
        return existingApproval;
      }

      const sameActionRequest = this.findBy("action_request_id = ?", [actionRequestId]);
      if (sameActionRequest) {
        throw new ApprovalServiceError(
          "CONFLICT",
          "Action request id is already attached to another approval",
        );
      }
      if (execution.state !== "running") {
        throw new ApprovalServiceError(
          "CONFLICT",
          "Only a running execution can request approval",
        );
      }
      if (!execution.leaseOwner) {
        throw new ApprovalServiceError(
          "CONFLICT",
          "Approval request requires an active worker lease",
        );
      }
      this.assertActiveContext(context, requiredPermission);

      const id = requireText(input.id ?? randomUUID(), "id");
      const fingerprint = contextFingerprint(
        { ...context, permissionSetParsed: this.permissionSet(context) },
        { actionType, requiredPermission, payload },
      );
      this.database
        .prepare(
          `
            INSERT INTO approvals
              (id, action_request_id, project_id, execution_id, assignment_id,
               action_type, required_permission, payload, context_fingerprint,
               idempotency_key, status, requested_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `,
        )
        .run(
          id,
          actionRequestId,
          execution.projectId,
          execution.id,
          execution.assignmentId,
          actionType,
          requiredPermission,
          JSON.stringify(payload),
          fingerprint,
          idempotencyKey,
          now,
          expiresAt,
        );

      this.executionService.transitionWithinTransaction(
        execution.id,
        "awaiting_approval",
        {
          workerId: execution.leaseOwner,
          reason: "approval_requested",
          actor: { type: "agent", id: context.agentId },
          now,
        },
      );
      this.recordResolutionEvent(
        "approval.requested",
        execution,
        { type: "agent", id: context.agentId },
        now,
        {
          approvalId: id,
          actionRequestId,
          actionType,
          status: "pending",
          expiresAt,
        },
      );
      return this.requireApproval(id);
    });
  }

  decideApproval(input: DecideApprovalInput): ApprovalRecord {
    const approvalId = requireText(input.approvalId, "approvalId");
    const decision = input.decision;
    if (decision !== "approved" && decision !== "denied") {
      throw new ApprovalServiceError("VALIDATION_ERROR", "Unknown approval decision");
    }
    const identity = this.requireOwnerIdentity(input.identity);
    const now = validateTimestamp(input.now ?? this.now());
    const reason =
      input.reason?.trim() || (decision === "approved" ? "approved" : "denied");

    return transaction(this.database, () => {
      const existing = this.requireApproval(approvalId);
      this.assertOwner(existing, identity);
      if (existing.status !== "pending") {
        if (existing.status === decision) return existing;
        if (existing.status === "expired") return existing;
        throw new ApprovalServiceError(
          "CONFLICT",
          "Approval has already received another terminal decision",
        );
      }

      if (Date.parse(existing.expiresAt) <= Date.parse(now)) {
        return this.expireWithinTransaction(existing, now, "approval_expired");
      }

      const execution = this.executionService.requireExecution(existing.executionId);
      if (!this.contextMatches(existing, execution)) {
        return this.denyWithinTransaction(existing, identity, now, "context_changed");
      }
      if (execution.state !== "awaiting_approval") {
        return this.denyWithinTransaction(
          existing,
          identity,
          now,
          "execution_not_awaiting_approval",
        );
      }

      if (decision === "denied") {
        return this.denyWithinTransaction(existing, identity, now, reason);
      }

      try {
        this.executionService.transitionWithinTransaction(execution.id, "running", {
          workerId: execution.leaseOwner ?? undefined,
          reason: "approval_approved",
          actor: identity,
          now,
        });
      } catch (error) {
        if (!(error instanceof ExecutionServiceError)) throw error;
        return this.denyWithinTransaction(existing, identity, now, "lease_lost");
      }
      const decided = this.updateDecision(
        existing.id,
        "approved",
        now,
        identity,
        reason,
      );
      this.recordResolutionEvent("approval.resolved", execution, identity, now, {
        approvalId: existing.id,
        actionRequestId: existing.actionRequestId,
        decision: "approved",
        status: decided.status,
        reason,
      });
      return decided;
    });
  }

  getApproval(approvalId: string) {
    return this.findBy("id = ?", [requireText(approvalId, "approvalId")])
      ? this.requireApproval(approvalId)
      : undefined;
  }

  listApprovals(input: ListApprovalsInput = {}) {
    const conditions = ["1 = 1"];
    const parameters: string[] = [];
    if (input.projectId !== undefined) {
      conditions.push("project_id = ?");
      parameters.push(requireText(input.projectId, "projectId"));
    }
    if (input.status !== undefined) {
      if (!APPROVAL_STATUSES.includes(input.status)) {
        throw new ApprovalServiceError("VALIDATION_ERROR", "Unknown approval status");
      }
      conditions.push("status = ?");
      parameters.push(input.status);
    }
    return this.database
      .prepare(
        `${APPROVAL_SELECT} WHERE ${conditions.join(" AND ")} ORDER BY requestedAt, id`,
      )
      .all(...parameters)
      .map((row) => toApproval(row as ApprovalRow));
  }

  listPending(projectId?: string, now = this.now()) {
    this.reconcilePending(now);
    return this.listApprovals({ projectId, status: "pending" });
  }

  reconcilePending(now = this.now()) {
    const timestamp = validateTimestamp(now);
    return transaction(this.database, () => {
      const rows = this.database
        .prepare(`${APPROVAL_SELECT} WHERE status = 'pending' ORDER BY requestedAt, id`)
        .all() as ApprovalRow[];
      const changed: ApprovalRecord[] = [];
      for (const row of rows) {
        const approval = toApproval(row);
        if (Date.parse(approval.expiresAt) <= Date.parse(timestamp)) {
          changed.push(
            this.expireWithinTransaction(approval, timestamp, "approval_expired"),
          );
          continue;
        }
        const execution = this.executionService.requireExecution(approval.executionId);
        if (execution.state !== "awaiting_approval") {
          changed.push(
            this.denyWithinTransaction(
              approval,
              { type: "system", id: "coderoom" },
              timestamp,
              "execution_not_awaiting_approval",
            ),
          );
        } else if (!this.contextMatches(approval, execution)) {
          changed.push(
            this.denyWithinTransaction(
              approval,
              { type: "system", id: "coderoom" },
              timestamp,
              "context_changed",
            ),
          );
        }
      }
      return changed;
    });
  }

  private requirePermission(value: string): Permission {
    const permission = requireText(value, "requiredPermission");
    if (!(CANONICAL_PERMISSIONS as readonly string[]).includes(permission)) {
      throw new ApprovalServiceError(
        "VALIDATION_ERROR",
        `Unknown approval permission: ${permission}`,
      );
    }
    return permission as Permission;
  }

  private requireOwnerIdentity(identity: ApprovalOwnerIdentity | undefined) {
    if (!identity) {
      throw new ApprovalServiceError(
        "UNAUTHORIZED",
        "Authenticated owner identity is required",
      );
    }
    if (identity.type !== "human" || !identity.id?.trim()) {
      throw new ApprovalServiceError(
        "FORBIDDEN",
        "Only an authenticated human owner can decide an approval",
      );
    }
    return { type: "human" as const, id: identity.id.trim() };
  }

  private assertOwner(approval: ApprovalRecord, identity: ApprovalOwnerIdentity) {
    if (
      !this.ownerAuthorizer({
        projectId: approval.projectId,
        identity,
        approval,
      })
    ) {
      throw new ApprovalServiceError(
        "FORBIDDEN",
        "Approval owner authorization failed",
      );
    }
  }

  private readContext(execution: ExecutionRecord) {
    const context = this.database
      .prepare(
        `
          SELECT
            p.id AS projectId,
            a.id AS assignmentId,
            a.agent_id AS agentId,
            a.permission_set AS permissionSet,
            a.status AS assignmentStatus,
            a.archived_at AS assignmentArchivedAt,
            p.status AS projectStatus,
            ag.archived_at AS agentArchivedAt
          FROM executions e
          JOIN assignments a ON a.id = e.assignment_id
          JOIN projects p ON p.id = e.project_id
          JOIN agents ag ON ag.id = a.agent_id
          WHERE e.id = ?
        `,
      )
      .get(execution.id) as ApprovalContextRow | undefined;
    if (!context || context.projectId !== execution.projectId) {
      throw new ApprovalServiceError(
        "CONFLICT",
        "Approval execution context is inconsistent",
      );
    }
    return context;
  }

  private permissionSet(context: ApprovalContextRow) {
    const permissionSet = parsePermissionSet(context.permissionSet);
    if (!permissionSet) {
      throw new ApprovalServiceError(
        "CONFLICT",
        "Approval permission context is invalid",
      );
    }
    return permissionSet;
  }

  private assertActiveContext(
    context: ApprovalContextRow,
    requiredPermission: Permission,
  ) {
    const permissionSet = this.permissionSet(context);
    if (context.projectStatus !== "active") {
      throw new ApprovalServiceError("CONFLICT", "Approval project is not active");
    }
    if (
      context.assignmentStatus !== "active" ||
      context.assignmentArchivedAt !== null
    ) {
      throw new ApprovalServiceError("CONFLICT", "Approval assignment is not active");
    }
    if (context.agentArchivedAt !== null) {
      throw new ApprovalServiceError("CONFLICT", "Approval agent is archived");
    }
    if (!permissionSet.includes(requiredPermission)) {
      throw new ApprovalServiceError(
        "FORBIDDEN",
        "Approval required permission is not currently granted",
      );
    }
  }

  private contextMatches(approval: ApprovalRecord, execution: ExecutionRecord) {
    try {
      const context = this.readContext(execution);
      const current = contextFingerprint(
        { ...context, permissionSetParsed: this.permissionSet(context) },
        {
          actionType: approval.actionType,
          requiredPermission: approval.requiredPermission,
          payload: approval.payload,
        },
      );
      return current === approval.contextFingerprint;
    } catch (error) {
      if (error instanceof ApprovalServiceError) return false;
      throw error;
    }
  }

  private updateDecision(
    approvalId: string,
    status: ApprovalStatus,
    decidedAt: string,
    actor: { type: "human" | "system"; id: string },
    reason: string,
  ) {
    this.database
      .prepare(
        `
          UPDATE approvals
          SET status = ?, decided_at = ?, decided_by_type = ?, decided_by_id = ?,
              decision_reason = ?
          WHERE id = ? AND status = 'pending'
        `,
      )
      .run(status, decidedAt, actor.type, actor.id, reason, approvalId);
    return this.requireApproval(approvalId);
  }

  private denyWithinTransaction(
    approval: ApprovalRecord,
    actor: { type: "human" | "system"; id: string },
    now: string,
    reason: string,
  ) {
    const execution = this.executionService.requireExecution(approval.executionId);
    const decided = this.updateDecision(approval.id, "denied", now, actor, reason);
    this.executionService.cancelAwaitingApprovalWithinTransaction(execution.id, {
      reason: `approval_denied:${reason}`,
      actor,
      now,
    });
    this.recordResolutionEvent("approval.resolved", execution, actor, now, {
      approvalId: approval.id,
      actionRequestId: approval.actionRequestId,
      decision: "denied",
      status: decided.status,
      reason,
    });
    return decided;
  }

  private expireWithinTransaction(
    approval: ApprovalRecord,
    now: string,
    reason: string,
  ) {
    const execution = this.executionService.requireExecution(approval.executionId);
    const actor = { type: "system" as const, id: "coderoom" };
    const decided = this.updateDecision(approval.id, "expired", now, actor, reason);
    this.executionService.cancelAwaitingApprovalWithinTransaction(execution.id, {
      reason,
      actor,
      now,
    });
    this.recordResolutionEvent("approval.resolved", execution, actor, now, {
      approvalId: approval.id,
      actionRequestId: approval.actionRequestId,
      decision: "expired",
      status: decided.status,
      reason,
    });
    return decided;
  }

  private recordResolutionEvent(
    type: "approval.requested" | "approval.resolved",
    execution: ExecutionRecord,
    actor: EventActor,
    createdAt: string,
    payload: Record<string, unknown>,
  ) {
    this.eventService.recordEvent({
      type,
      version: 1,
      projectId: execution.projectId,
      actor,
      correlationId: execution.id,
      createdAt,
      payload,
    });
  }

  private findBy(condition: string, parameters: readonly (string | number)[]) {
    return this.database
      .prepare(`${APPROVAL_SELECT} WHERE ${condition} LIMIT 1`)
      .get(...parameters) as ApprovalRow | undefined;
  }

  private requireApproval(approvalId: string) {
    const row = this.findBy("id = ?", [requireText(approvalId, "approvalId")]);
    if (!row) throw new ApprovalServiceError("NOT_FOUND", "Approval not found");
    return toApproval(row);
  }
}
