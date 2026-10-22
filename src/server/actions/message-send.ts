import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { ConversationService } from "../conversations/service.js";
import { EventService } from "../events/service.js";
import { ExecutionService, type ExecutionRecord } from "../executions/service.js";
import {
  MessageService,
  type MessageRecord,
  type MessageReferenceInput,
} from "../messages/service.js";
import {
  AuthorizationService,
  type TrustedIdentity,
} from "../security/authorization.js";

export type StructuredMessageSendAction = {
  type: string;
  /** Client-provided action ids are accepted as envelope metadata only. */
  actionId?: string;
  executionId: string;
  projectId: string;
  idempotencyKey: string;
  payload: unknown;
};

type MessageSendActionContext = {
  identity: TrustedIdentity;
  correlationId?: string;
};

export type MessageSendActionInput =
  | (MessageSendActionContext & {
      action: StructuredMessageSendAction;
    })
  | (StructuredMessageSendAction & MessageSendActionContext);

export type MessageSendActionResult = {
  actionId: string;
  executionId: string;
  message: MessageRecord;
  replayed: boolean;
};

export class MessageSendActionError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "MessageSendActionError";
  }
}

type MessageSendPayload = {
  conversationId: string;
  text: string;
  references?: MessageReferenceInput[];
};

type ActionRow = {
  id: string;
  actionId: string;
  idempotencyKey: string;
  executionId: string;
  projectId: string;
  assignmentId: string;
  conversationId: string;
  messageId: string;
  requestFingerprint: string;
  createdAt: string;
};

const ACTION_PAYLOAD_FIELDS = ["conversationId", "text", "references"];
const REFERENCE_FIELDS = ["type", "id"];
const REFERENCE_TYPES = ["project", "conversation", "agent"] as const;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new MessageSendActionError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new MessageSendActionError(
      "VALIDATION_ERROR",
      `${context} contains unknown field: ${unknown}`,
    );
  }
}

function normalizeReferences(value: unknown): MessageReferenceInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) {
    throw new MessageSendActionError(
      "VALIDATION_ERROR",
      "payload.references must contain at most 20 items",
    );
  }
  const references: MessageReferenceInput[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new MessageSendActionError(
        "VALIDATION_ERROR",
        `payload.references[${index}] must be an object`,
      );
    }
    rejectUnknownFields(entry, REFERENCE_FIELDS, `payload.references[${index}]`);
    if (
      typeof entry.type !== "string" ||
      !(REFERENCE_TYPES as readonly string[]).includes(entry.type) ||
      typeof entry.id !== "string" ||
      !entry.id.trim()
    ) {
      throw new MessageSendActionError(
        "VALIDATION_ERROR",
        `payload.references[${index}] is invalid`,
      );
    }
    const type = entry.type as MessageReferenceInput["type"];
    const id = entry.id.trim();
    const key = `${type}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    references.push({ type, id });
  });
  return references;
}

function normalizePayload(value: unknown): MessageSendPayload {
  if (!isRecord(value)) {
    throw new MessageSendActionError(
      "VALIDATION_ERROR",
      "message.send payload must be an object",
    );
  }
  rejectUnknownFields(value, ACTION_PAYLOAD_FIELDS, "message.send payload");
  if (typeof value.conversationId !== "string" || !value.conversationId.trim()) {
    throw new MessageSendActionError(
      "VALIDATION_ERROR",
      "payload.conversationId must be a non-empty string",
    );
  }
  if (typeof value.text !== "string" || !value.text.trim()) {
    throw new MessageSendActionError(
      "VALIDATION_ERROR",
      "payload.text must be a non-empty string",
    );
  }
  return {
    conversationId: value.conversationId.trim(),
    text: value.text.trim(),
    references: normalizeReferences(value.references),
  };
}

function fingerprint(input: {
  action: StructuredMessageSendAction;
  payload: MessageSendPayload;
  identity: TrustedIdentity;
}) {
  return JSON.stringify({
    type: "message.send",
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

function actionRowFromDatabase(row: ActionRow) {
  return row;
}

function errorCode(value: unknown): MessageSendActionError["code"] | undefined {
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
  if (code === "INVALID_TRANSITION" || code === "LEASE_REQUIRED") {
    return "CONFLICT";
  }
  return undefined;
}

function asActionError(error: unknown): MessageSendActionError | undefined {
  if (error instanceof MessageSendActionError) return error;
  const code = errorCode(error);
  if (!code) return undefined;
  return new MessageSendActionError(
    code,
    error instanceof Error ? error.message : "Structured message action failed",
  );
}

export class StructuredMessageActionService {
  private readonly authorization: AuthorizationService;
  private readonly conversations: ConversationService;
  private readonly events: EventService;
  private readonly executions: ExecutionService;
  private readonly messages: MessageService;

  constructor(private readonly database: DatabaseSync) {
    this.authorization = new AuthorizationService(database);
    this.conversations = new ConversationService(database);
    this.events = new EventService(database);
    this.executions = new ExecutionService(database);
    this.messages = new MessageService(database);
  }

  handle(input: MessageSendActionInput): MessageSendActionResult {
    const action = this.normalizeAction("action" in input ? input.action : input);
    const payload = normalizePayload(action.payload);
    const identity = input.identity;
    const requestFingerprint = fingerprint({ action, payload, identity });

    try {
      return transaction(this.database, () =>
        this.handleWithinTransaction({
          action,
          payload,
          identity,
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

  dispatch(input: MessageSendActionInput) {
    return this.handle(input);
  }

  execute(input: MessageSendActionInput) {
    return this.handle(input);
  }

  private normalizeAction(input: StructuredMessageSendAction) {
    if (!isRecord(input)) {
      throw new MessageSendActionError(
        "VALIDATION_ERROR",
        "Structured action must be an object",
      );
    }
    if (input.type !== "message.send") {
      throw new MessageSendActionError(
        "VALIDATION_ERROR",
        "Unsupported structured action type",
      );
    }
    return {
      ...input,
      type: "message.send" as const,
      executionId: requireText(input.executionId, "executionId"),
      projectId: requireText(input.projectId, "projectId"),
      idempotencyKey: requireText(input.idempotencyKey, "idempotencyKey"),
    };
  }

  private handleWithinTransaction(input: {
    action: StructuredMessageSendAction & { type: "message.send" };
    payload: MessageSendPayload;
    identity: TrustedIdentity;
    requestFingerprint: string;
    correlationId?: string;
  }): MessageSendActionResult {
    const existing = this.readAction(input.action.idempotencyKey);
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new MessageSendActionError(
          "CONFLICT",
          "Action idempotency key was already used for another message request",
        );
      }
      const message = this.messages.getMessage(existing.messageId);
      if (!message) {
        throw new MessageSendActionError(
          "CONFLICT",
          "Message for idempotent action is missing",
        );
      }
      return {
        actionId: existing.actionId,
        executionId: existing.executionId,
        message,
        replayed: true,
      };
    }

    const execution = this.executions.getExecution(input.action.executionId);
    if (!execution) {
      throw new MessageSendActionError("NOT_FOUND", "Execution not found");
    }
    this.assertExecutionContext(execution, input.action, input.identity);
    const conversation = this.conversations.getConversation(
      input.payload.conversationId,
    );
    if (!conversation) {
      throw new MessageSendActionError("NOT_FOUND", "Conversation not found");
    }
    if (conversation.projectId !== execution.projectId) {
      throw new MessageSendActionError(
        "FORBIDDEN",
        "Action conversation does not belong to execution project",
      );
    }
    this.conversations.assertAccessible({
      conversationId: input.payload.conversationId,
      agentId: input.identity.id,
    });
    const authorization = this.authorization.authorize({
      projectId: execution.projectId,
      permission: "message.send",
      identity: input.identity,
    });
    if (!authorization.allowed) {
      throw new MessageSendActionError(
        authorization.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        "Structured message action is not authorized",
      );
    }

    if (execution.state !== "running") {
      throw new MessageSendActionError(
        "CONFLICT",
        "Only a running execution can send a structured message",
      );
    }

    const message = this.messages.sendMessageWithinTransaction({
      id: randomUUID(),
      conversationId: input.payload.conversationId,
      identity: input.identity,
      text: input.payload.text,
      references: input.payload.references,
      idempotencyKey: `message.send:${input.action.idempotencyKey}`,
      correlationId: input.correlationId ?? input.action.idempotencyKey,
    });
    const actionId = `act_${randomUUID()}`;
    const actionRecordId = randomUUID();
    this.database
      .prepare(
        `
          INSERT INTO message_send_actions
            (id, action_id, idempotency_key, execution_id, project_id,
             assignment_id, conversation_id, message_id, request_fingerprint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        actionRecordId,
        actionId,
        input.action.idempotencyKey,
        execution.id,
        execution.projectId,
        execution.assignmentId,
        input.payload.conversationId,
        message.id,
        input.requestFingerprint,
      );
    this.events.recordEvent({
      type: "action.message_send.accepted",
      version: 1,
      projectId: execution.projectId,
      actor: { type: input.identity.type, id: input.identity.id },
      correlationId: input.correlationId ?? input.action.idempotencyKey,
      causationId: execution.id,
      payload: {
        actionId,
        executionId: execution.id,
        conversationId: input.payload.conversationId,
        messageId: message.id,
      },
    });
    return { actionId, executionId: execution.id, message, replayed: false };
  }

  private assertExecutionContext(
    execution: ExecutionRecord,
    action: StructuredMessageSendAction,
    identity: TrustedIdentity,
  ) {
    if (action.projectId !== execution.projectId) {
      throw new MessageSendActionError(
        "FORBIDDEN",
        "Action project does not match execution project",
      );
    }
    if (identity.type !== "agent" || identity.assignmentId !== execution.assignmentId) {
      throw new MessageSendActionError(
        "FORBIDDEN",
        "Action identity does not match execution assignment",
      );
    }
    const assignment = this.database
      .prepare("SELECT agent_id AS agentId FROM assignments WHERE id = ?")
      .get(execution.assignmentId) as { agentId: string } | undefined;
    if (!assignment || assignment.agentId !== identity.id) {
      throw new MessageSendActionError(
        "FORBIDDEN",
        "Action identity does not match execution agent",
      );
    }
  }

  private readAction(idempotencyKey: string) {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            action_id AS actionId,
            idempotency_key AS idempotencyKey,
            execution_id AS executionId,
            project_id AS projectId,
            assignment_id AS assignmentId,
            conversation_id AS conversationId,
            message_id AS messageId,
            request_fingerprint AS requestFingerprint,
            created_at AS createdAt
          FROM message_send_actions
          WHERE idempotency_key = ?
        `,
      )
      .get(idempotencyKey) as ActionRow | undefined;
    return row ? actionRowFromDatabase(row) : undefined;
  }

  private recordRejection(
    input: MessageSendActionInput,
    action: StructuredMessageSendAction,
    payload: MessageSendPayload,
    error: MessageSendActionError,
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
          type: "action.message_send.rejected",
          version: 1,
          projectId: project ? action.projectId : null,
          actor,
          correlationId:
            input.correlationId?.trim() || action.idempotencyKey || randomUUID(),
          causationId: action.executionId?.trim() || null,
          payload: {
            actionType: "message.send",
            executionId: action.executionId,
            projectId: action.projectId,
            conversationId: payload.conversationId,
            reason: error.code,
          },
        }),
      );
    } catch {
      // The original action error remains authoritative if audit persistence fails.
    }
  }
}

export const MessageSendActionService = StructuredMessageActionService;
export const MessageActionService = StructuredMessageActionService;
export const MessageSendActionBridge = StructuredMessageActionService;
