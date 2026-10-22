import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import {
  AuthorizationService,
  type TrustedIdentity,
} from "../security/authorization.js";
import { EventService } from "../events/service.js";
import { ExecutionService, type ExecutionRecord } from "../executions/service.js";
import {
  REVIEW_DECISIONS,
  ReviewService,
  ReviewServiceError,
  type ReviewDecision,
  type ReviewRecord,
  type ReviewSubmissionRecord,
} from "../reviews/service.js";
import type { TicketRecord } from "../tickets/service.js";

export const REVIEW_ACTION_TYPES = ["ticket.submit_review", "review.submit"] as const;
export type ReviewActionType = (typeof REVIEW_ACTION_TYPES)[number];

export type StructuredReviewAction = {
  type: ReviewActionType;
  actionId?: string;
  executionId: string;
  projectId: string;
  idempotencyKey: string;
  payload: unknown;
};

export type ReviewActionInput = {
  action: StructuredReviewAction;
  identity: TrustedIdentity;
  correlationId?: string;
};

export type ReviewActionResult = {
  actionId: string;
  actionType: ReviewActionType;
  executionId: string;
  ticket: TicketRecord;
  submission?: ReviewSubmissionRecord;
  review?: ReviewRecord;
  replayed: boolean;
};

export class ReviewActionError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "ReviewActionError";
  }
}

type SubmitReviewPayload = {
  ticketId: string;
  deliverableId: string;
};

type ReviewSubmitPayload = SubmitReviewPayload & {
  decision: ReviewDecision;
  reason?: string;
};

type ReviewActionPayload = SubmitReviewPayload | ReviewSubmitPayload;

type ReviewActionRow = {
  actionId: string;
  actionType: ReviewActionType;
  executionId: string;
  projectId: string;
  assignmentId: string;
  ticketId: string;
  requestFingerprint: string;
  resultJson: string;
};

type StoredReviewActionResult = Omit<ReviewActionResult, "replayed">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new ReviewActionError(
      "VALIDATION_ERROR",
      `${field} must be a non-empty string`,
    );
  }
  return value.trim();
}

function optionalText(value: unknown, field: string) {
  if (value === undefined) return undefined;
  return requireText(value, field);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new ReviewActionError(
      "VALIDATION_ERROR",
      `${context} contains unknown field: ${unknown}`,
    );
  }
}

function normalizeAction(input: StructuredReviewAction) {
  if (!isRecord(input)) {
    throw new ReviewActionError(
      "VALIDATION_ERROR",
      "Structured action must be an object",
    );
  }
  if (!(REVIEW_ACTION_TYPES as readonly string[]).includes(String(input.type))) {
    throw new ReviewActionError("VALIDATION_ERROR", "Unsupported review action type");
  }
  return {
    ...input,
    type: input.type as ReviewActionType,
    executionId: requireText(input.executionId, "executionId"),
    projectId: requireText(input.projectId, "projectId"),
    idempotencyKey: requireText(input.idempotencyKey, "idempotencyKey"),
  };
}

function normalizePayload(type: ReviewActionType, value: unknown): ReviewActionPayload {
  if (!isRecord(value)) {
    throw new ReviewActionError(
      "VALIDATION_ERROR",
      `${type} payload must be an object`,
    );
  }
  if (type === "ticket.submit_review") {
    rejectUnknownFields(
      value,
      ["ticketId", "deliverableId"],
      "ticket.submit_review payload",
    );
    return {
      ticketId: requireText(value.ticketId, "payload.ticketId"),
      deliverableId: requireText(value.deliverableId, "payload.deliverableId"),
    };
  }
  rejectUnknownFields(
    value,
    ["ticketId", "deliverableId", "decision", "reason"],
    "review.submit payload",
  );
  const decision = requireText(value.decision, "payload.decision");
  if (!(REVIEW_DECISIONS as readonly string[]).includes(decision)) {
    throw new ReviewActionError("VALIDATION_ERROR", "Unknown review decision");
  }
  return {
    ticketId: requireText(value.ticketId, "payload.ticketId"),
    deliverableId: requireText(value.deliverableId, "payload.deliverableId"),
    decision: decision as ReviewDecision,
    reason: optionalText(value.reason, "payload.reason"),
  };
}

function fingerprint(input: {
  action: StructuredReviewAction;
  payload: ReviewActionPayload;
  identity: TrustedIdentity;
}) {
  return JSON.stringify({
    type: input.action.type,
    executionId: input.action.executionId,
    projectId: input.action.projectId,
    payload: input.payload,
    identity: {
      type: input.identity.type,
      id: input.identity.id,
      assignmentId: input.identity.assignmentId ?? null,
    },
  });
}

function parseStoredResult(value: string): StoredReviewActionResult {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      isRecord(parsed) &&
      typeof parsed.actionId === "string" &&
      typeof parsed.actionType === "string" &&
      typeof parsed.executionId === "string" &&
      isRecord(parsed.ticket)
    ) {
      return parsed as unknown as StoredReviewActionResult;
    }
  } catch {
    // The row is treated as corrupt below.
  }
  throw new ReviewActionError("CONFLICT", "Stored review action result is invalid");
}

function asActionError(error: unknown) {
  if (error instanceof ReviewActionError) return error;
  if (error instanceof ReviewServiceError) {
    return new ReviewActionError(
      error.code === "VALIDATION_ERROR"
        ? "VALIDATION_ERROR"
        : error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "FORBIDDEN"
            ? "FORBIDDEN"
            : "CONFLICT",
      error.message,
    );
  }
  return undefined;
}

export class StructuredReviewActionService {
  private readonly authorization: AuthorizationService;
  private readonly events: EventService;
  private readonly executions: ExecutionService;
  private readonly reviews: ReviewService;

  constructor(private readonly database: DatabaseSync) {
    this.authorization = new AuthorizationService(database);
    this.events = new EventService(database);
    this.executions = new ExecutionService(database);
    this.reviews = new ReviewService(database);
  }

  handle(input: ReviewActionInput): ReviewActionResult {
    const action = normalizeAction(input.action);
    const payload = normalizePayload(action.type, action.payload);
    const requestFingerprint = fingerprint({
      action,
      payload,
      identity: input.identity,
    });

    try {
      return transaction(this.database, () =>
        this.handleWithinTransaction({
          action,
          payload,
          identity: input.identity,
          requestFingerprint,
          correlationId: input.correlationId,
        }),
      );
    } catch (error) {
      const actionError = asActionError(error);
      if (!actionError) throw error;
      this.recordRejection(input, action, payload, actionError);
      throw actionError;
    }
  }

  dispatch(input: ReviewActionInput) {
    return this.handle(input);
  }

  execute(input: ReviewActionInput) {
    return this.handle(input);
  }

  private handleWithinTransaction(input: {
    action: StructuredReviewAction;
    payload: ReviewActionPayload;
    identity: TrustedIdentity;
    requestFingerprint: string;
    correlationId?: string;
  }): ReviewActionResult {
    const existing = this.readAction(input.action.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new ReviewActionError(
          "CONFLICT",
          "Action idempotency key was already used for another review request",
        );
      }
      return { ...parseStoredResult(existing.resultJson), replayed: true };
    }

    const execution = this.executions.getExecution(input.action.executionId);
    if (!execution) throw new ReviewActionError("NOT_FOUND", "Execution not found");
    this.assertExecutionContext(execution, input.action, input.identity);
    if (execution.state !== "running") {
      throw new ReviewActionError(
        "CONFLICT",
        "Only a running execution can issue a structured review action",
      );
    }
    const permission =
      input.action.type === "ticket.submit_review"
        ? "ticket.submit_review"
        : "review.submit";
    const authorization = this.authorization.authorize({
      projectId: execution.projectId,
      permission,
      identity: input.identity,
      correlationId: input.correlationId ?? input.action.idempotencyKey,
    });
    if (!authorization.allowed) {
      throw new ReviewActionError(
        authorization.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        "Structured review action is not authorized",
      );
    }

    const actor = { type: "agent" as const, id: input.identity.id };
    const payload = input.payload;
    const ticketId = payload.ticketId;
    const actionId = `act_${randomUUID()}`;
    let stored: StoredReviewActionResult;
    if (input.action.type === "ticket.submit_review") {
      const result = this.reviews.submitForReviewWithinTransaction({
        ticketId,
        deliverableId: payload.deliverableId,
        executionId: execution.id,
        actor,
        idempotencyKey: `action:${input.action.idempotencyKey}`,
        correlationId: input.correlationId,
      });
      stored = {
        actionId,
        actionType: input.action.type,
        executionId: execution.id,
        ticket: result.ticket,
        submission: result.submission,
      };
    } else {
      const reviewPayload = payload as ReviewSubmitPayload;
      const result = this.reviews.recordReviewWithinTransaction({
        ticketId,
        deliverableId: reviewPayload.deliverableId,
        executionId: execution.id,
        reviewerAssignmentId: input.identity.assignmentId,
        actor,
        decision: reviewPayload.decision,
        reason: reviewPayload.reason,
        idempotencyKey: `action:${input.action.idempotencyKey}`,
        correlationId: input.correlationId,
      });
      stored = {
        actionId,
        actionType: input.action.type,
        executionId: execution.id,
        ticket: result.ticket,
        review: result.review,
      };
    }
    this.database
      .prepare(
        `
          INSERT INTO review_action_requests
            (id, action_id, idempotency_key, action_type, execution_id,
             project_id, assignment_id, ticket_id, request_fingerprint, result_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        randomUUID(),
        stored.actionId,
        input.action.idempotencyKey,
        input.action.type,
        execution.id,
        execution.projectId,
        execution.assignmentId,
        ticketId,
        input.requestFingerprint,
        JSON.stringify(stored),
      );
    this.events.recordEvent({
      type: "action.review.accepted",
      version: 1,
      projectId: execution.projectId,
      actor,
      correlationId: input.correlationId ?? input.action.idempotencyKey,
      causationId: execution.id,
      payload: {
        actionId,
        actionType: input.action.type,
        executionId: execution.id,
        ticketId,
        deliverableId: payload.deliverableId,
      },
    });
    return { ...stored, replayed: false };
  }

  private assertExecutionContext(
    execution: ExecutionRecord,
    action: StructuredReviewAction,
    identity: TrustedIdentity,
  ) {
    if (action.projectId !== execution.projectId) {
      throw new ReviewActionError(
        "FORBIDDEN",
        "Action project does not match execution project",
      );
    }
    if (identity.type !== "agent" || identity.assignmentId !== execution.assignmentId) {
      throw new ReviewActionError(
        "FORBIDDEN",
        "Action identity does not match execution assignment",
      );
    }
    const assignment = this.database
      .prepare("SELECT agent_id AS agentId FROM assignments WHERE id = ?")
      .get(execution.assignmentId) as { agentId: string } | undefined;
    if (!assignment || assignment.agentId !== identity.id) {
      throw new ReviewActionError(
        "FORBIDDEN",
        "Action identity does not match execution agent",
      );
    }
  }

  private readAction(idempotencyKey: string) {
    return this.database
      .prepare(
        `
          SELECT
            action_id AS actionId,
            action_type AS actionType,
            execution_id AS executionId,
            project_id AS projectId,
            assignment_id AS assignmentId,
            ticket_id AS ticketId,
            request_fingerprint AS requestFingerprint,
            result_json AS resultJson
          FROM review_action_requests
          WHERE idempotency_key = ?
        `,
      )
      .get(idempotencyKey) as ReviewActionRow | undefined;
  }

  private recordRejection(
    input: ReviewActionInput,
    action: StructuredReviewAction,
    payload: ReviewActionPayload,
    error: ReviewActionError,
  ) {
    try {
      const actor =
        input.identity &&
        ["agent", "human", "system"].includes(input.identity.type) &&
        typeof input.identity.id === "string" &&
        input.identity.id.trim()
          ? { type: input.identity.type, id: input.identity.id.trim() }
          : { type: "system" as const, id: "coderoom" };
      const project = this.database
        .prepare("SELECT 1 FROM projects WHERE id = ?")
        .get(action.projectId);
      transaction(this.database, () =>
        this.events.recordEvent({
          type: "action.review.rejected",
          version: 1,
          projectId: project ? action.projectId : null,
          actor,
          correlationId:
            input.correlationId?.trim() || action.idempotencyKey || randomUUID(),
          causationId: action.executionId?.trim() || null,
          payload: {
            actionType: action.type,
            executionId: action.executionId,
            projectId: action.projectId,
            ticketId: payload.ticketId,
            reason: error.code,
          },
        }),
      );
    } catch {
      // The original action error remains authoritative if audit persistence fails.
    }
  }
}
