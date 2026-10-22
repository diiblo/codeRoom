import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { EventService, type EventActor } from "../events/service.js";
import { ExecutionService, type ExecutionRecord } from "../executions/service.js";
import {
  TICKET_STATES,
  TicketService,
  type TicketRecord,
  type TicketState,
} from "../tickets/service.js";
import {
  AuthorizationService,
  type TrustedIdentity,
} from "../security/authorization.js";

export const TICKET_ACTION_TYPES = [
  "ticket.create",
  "ticket.assign",
  "ticket.update",
] as const;

export type TicketActionType = (typeof TICKET_ACTION_TYPES)[number];

export type StructuredTicketAction = {
  type: TicketActionType;
  /** Client-provided action ids are accepted as envelope metadata only. */
  actionId?: string;
  executionId: string;
  projectId: string;
  idempotencyKey: string;
  payload: unknown;
};

export type TicketActionInput = {
  action: StructuredTicketAction;
  identity: TrustedIdentity;
  correlationId?: string;
};

export type TicketActionResult = {
  actionId: string;
  actionType: TicketActionType;
  executionId: string;
  ticket: TicketRecord;
  replayed: boolean;
};

export class TicketActionError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "TicketActionError";
  }
}

type TicketCreatePayload = {
  title: string;
  body: string;
  acceptanceCriteria: string[];
  priority?: string;
};

type TicketAssignPayload = {
  ticketId: string;
  ownerId: string;
};

type TicketUpdatePayload = {
  ticketId: string;
  nextState: TicketState;
  reason?: string;
};

type TicketActionPayload =
  TicketCreatePayload | TicketAssignPayload | TicketUpdatePayload;

type TicketActionRow = {
  actionId: string;
  actionType: TicketActionType;
  executionId: string;
  projectId: string;
  assignmentId: string;
  ticketId: string;
  requestFingerprint: string;
  resultJson: string;
};

type StoredTicketActionResult = Omit<TicketActionResult, "replayed">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TicketActionError(
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
    throw new TicketActionError(
      "VALIDATION_ERROR",
      `${context} contains unknown field: ${unknown}`,
    );
  }
}

function requiredStringArray(value: unknown, field: string) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new TicketActionError(
      "VALIDATION_ERROR",
      `${field} must contain at least one non-empty string`,
    );
  }
  return [...new Set(value.map((entry) => (entry as string).trim()))];
}

function normalizeAction(input: StructuredTicketAction) {
  if (!isRecord(input)) {
    throw new TicketActionError(
      "VALIDATION_ERROR",
      "Structured action must be an object",
    );
  }
  if (!(TICKET_ACTION_TYPES as readonly string[]).includes(String(input.type))) {
    throw new TicketActionError("VALIDATION_ERROR", "Unsupported ticket action type");
  }
  return {
    ...input,
    type: input.type as TicketActionType,
    executionId: requireText(input.executionId, "executionId"),
    projectId: requireText(input.projectId, "projectId"),
    idempotencyKey: requireText(input.idempotencyKey, "idempotencyKey"),
  };
}

function normalizePayload(type: TicketActionType, value: unknown): TicketActionPayload {
  if (!isRecord(value)) {
    throw new TicketActionError(
      "VALIDATION_ERROR",
      `${type} payload must be an object`,
    );
  }

  if (type === "ticket.create") {
    rejectUnknownFields(
      value,
      ["title", "body", "acceptanceCriteria", "priority"],
      "ticket.create payload",
    );
    return {
      title: requireText(value.title, "payload.title"),
      body: requireText(value.body, "payload.body"),
      acceptanceCriteria: requiredStringArray(
        value.acceptanceCriteria,
        "payload.acceptanceCriteria",
      ),
      priority: optionalText(value.priority, "payload.priority"),
    };
  }

  if (type === "ticket.assign") {
    rejectUnknownFields(value, ["ticketId", "ownerId"], "ticket.assign payload");
    return {
      ticketId: requireText(value.ticketId, "payload.ticketId"),
      ownerId: requireText(value.ownerId, "payload.ownerId"),
    };
  }

  rejectUnknownFields(
    value,
    ["ticketId", "nextState", "reason"],
    "ticket.update payload",
  );
  const nextState = requireText(value.nextState, "payload.nextState");
  if (!(TICKET_STATES as readonly string[]).includes(nextState)) {
    throw new TicketActionError("VALIDATION_ERROR", "Unknown ticket state");
  }
  return {
    ticketId: requireText(value.ticketId, "payload.ticketId"),
    nextState: nextState as TicketState,
    reason: optionalText(value.reason, "payload.reason"),
  };
}

function fingerprint(input: {
  action: StructuredTicketAction;
  payload: TicketActionPayload;
  identity: TrustedIdentity;
}) {
  return JSON.stringify({
    type: input.action.type,
    executionId: input.action.executionId,
    projectId: input.action.projectId,
    idempotencyKey: input.action.idempotencyKey,
    payload: input.payload,
    identity: {
      type: input.identity.type,
      id: input.identity.id,
      assignmentId: input.identity.assignmentId ?? null,
    },
  });
}

function parseStoredResult(value: string): StoredTicketActionResult {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      isRecord(parsed) &&
      typeof parsed.actionId === "string" &&
      typeof parsed.actionType === "string" &&
      typeof parsed.executionId === "string" &&
      isRecord(parsed.ticket)
    ) {
      return parsed as unknown as StoredTicketActionResult;
    }
  } catch {
    // The row is treated as corrupt below.
  }
  throw new TicketActionError("CONFLICT", "Stored ticket action result is invalid");
}

function errorCode(value: unknown): TicketActionError["code"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const code = (value as { code?: unknown }).code;
  if (
    code === "VALIDATION_ERROR" ||
    code === "UNAUTHORIZED" ||
    code === "FORBIDDEN" ||
    code === "NOT_FOUND" ||
    code === "CONFLICT"
  ) {
    return code;
  }
  if (code === "INVALID_TRANSITION") return "CONFLICT";
  return undefined;
}

function asActionError(error: unknown) {
  if (error instanceof TicketActionError) return error;
  const code = errorCode(error);
  if (!code) return undefined;
  return new TicketActionError(
    code,
    error instanceof Error ? error.message : "Structured ticket action failed",
  );
}

export class StructuredTicketActionService {
  private readonly authorization: AuthorizationService;
  private readonly events: EventService;
  private readonly executions: ExecutionService;
  private readonly tickets: TicketService;

  constructor(private readonly database: DatabaseSync) {
    this.authorization = new AuthorizationService(database);
    this.events = new EventService(database);
    this.executions = new ExecutionService(database);
    this.tickets = new TicketService(database);
  }

  handle(input: TicketActionInput): TicketActionResult {
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

  dispatch(input: TicketActionInput) {
    return this.handle(input);
  }

  execute(input: TicketActionInput) {
    return this.handle(input);
  }

  private handleWithinTransaction(input: {
    action: StructuredTicketAction;
    payload: TicketActionPayload;
    identity: TrustedIdentity;
    requestFingerprint: string;
    correlationId?: string;
  }): TicketActionResult {
    const existing = this.readAction(input.action.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new TicketActionError(
          "CONFLICT",
          "Action idempotency key was already used for another ticket request",
        );
      }
      const stored = parseStoredResult(existing.resultJson);
      return { ...stored, replayed: true };
    }

    const execution = this.executions.getExecution(input.action.executionId);
    if (!execution) throw new TicketActionError("NOT_FOUND", "Execution not found");
    this.assertExecutionContext(execution, input.action, input.identity);
    if (execution.state !== "running") {
      throw new TicketActionError(
        "CONFLICT",
        "Only a running execution can issue a structured ticket action",
      );
    }

    const permission =
      input.action.type === "ticket.create"
        ? "ticket.create"
        : input.action.type === "ticket.assign"
          ? "ticket.assign"
          : "ticket.update";
    const authorization = this.authorization.authorize({
      projectId: execution.projectId,
      permission,
      identity: input.identity,
      correlationId: input.correlationId ?? input.action.idempotencyKey,
    });
    if (!authorization.allowed) {
      throw new TicketActionError(
        authorization.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        "Structured ticket action is not authorized",
      );
    }

    const actor: EventActor = { type: "agent", id: input.identity.id };
    const domainIdempotencyKey = `ticket-action:${input.action.type}:${input.action.idempotencyKey}`;
    let ticket: TicketRecord;
    if (input.action.type === "ticket.create") {
      const payload = input.payload as TicketCreatePayload;
      ticket = this.tickets.createTicketWithinTransaction({
        projectId: execution.projectId,
        title: payload.title,
        body: payload.body,
        acceptanceCriteria: payload.acceptanceCriteria,
        priority: payload.priority,
        author: actor,
        idempotencyKey: domainIdempotencyKey,
      });
    } else if (input.action.type === "ticket.assign") {
      const payload = input.payload as TicketAssignPayload;
      ticket = this.tickets.assignTicketWithinTransaction({
        ticketId: payload.ticketId,
        ownerId: payload.ownerId,
        actor,
      });
      this.assertTicketProject(ticket, execution.projectId);
    } else {
      const payload = input.payload as TicketUpdatePayload;
      if (payload.nextState === "in_review") {
        throw new TicketActionError(
          "CONFLICT",
          "Use ticket.submit_review with a verified deliverable",
        );
      }
      const candidate = this.tickets.requireTicket(payload.ticketId);
      this.assertTicketProject(candidate, execution.projectId);
      ticket = this.tickets.transitionTicketWithinTransaction({
        ticketId: payload.ticketId,
        nextState: payload.nextState,
        reason: payload.reason,
        actor,
        idempotencyKey: domainIdempotencyKey,
      });
    }

    const actionId = `act_${randomUUID()}`;
    const stored: StoredTicketActionResult = {
      actionId,
      actionType: input.action.type,
      executionId: execution.id,
      ticket,
    };
    this.database
      .prepare(
        `
          INSERT INTO ticket_action_requests
            (id, action_id, idempotency_key, action_type, execution_id,
             project_id, assignment_id, ticket_id, request_fingerprint, result_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        randomUUID(),
        actionId,
        input.action.idempotencyKey,
        input.action.type,
        execution.id,
        execution.projectId,
        execution.assignmentId,
        ticket.id,
        input.requestFingerprint,
        JSON.stringify(stored),
      );
    this.events.recordEvent({
      type: "action.ticket.accepted",
      version: 1,
      projectId: execution.projectId,
      actor,
      correlationId: input.correlationId ?? input.action.idempotencyKey,
      causationId: execution.id,
      payload: {
        actionId,
        actionType: input.action.type,
        executionId: execution.id,
        ticketId: ticket.id,
      },
    });
    return { ...stored, replayed: false };
  }

  private assertExecutionContext(
    execution: ExecutionRecord,
    action: StructuredTicketAction,
    identity: TrustedIdentity,
  ) {
    if (action.projectId !== execution.projectId) {
      throw new TicketActionError(
        "FORBIDDEN",
        "Action project does not match execution project",
      );
    }
    if (identity.type !== "agent" || identity.assignmentId !== execution.assignmentId) {
      throw new TicketActionError(
        "FORBIDDEN",
        "Action identity does not match execution assignment",
      );
    }
    const assignment = this.database
      .prepare("SELECT agent_id AS agentId FROM assignments WHERE id = ?")
      .get(execution.assignmentId) as { agentId: string } | undefined;
    if (!assignment || assignment.agentId !== identity.id) {
      throw new TicketActionError(
        "FORBIDDEN",
        "Action identity does not match execution agent",
      );
    }
  }

  private assertTicketProject(ticket: TicketRecord, projectId: string) {
    if (ticket.projectId !== projectId) {
      throw new TicketActionError(
        "FORBIDDEN",
        "Ticket does not belong to the execution project",
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
          FROM ticket_action_requests
          WHERE idempotency_key = ?
        `,
      )
      .get(idempotencyKey) as TicketActionRow | undefined;
  }

  private recordRejection(
    input: TicketActionInput,
    action: StructuredTicketAction,
    payload: TicketActionPayload,
    error: TicketActionError,
  ) {
    try {
      const rejectedTicketId = "ticketId" in payload ? payload.ticketId : null;
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
          type: "action.ticket.rejected",
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
            ticketId: rejectedTicketId,
            reason: error.code,
          },
        }),
      );
    } catch {
      // The original action error remains authoritative if audit persistence fails.
    }
  }
}

export const TicketActionService = StructuredTicketActionService;
