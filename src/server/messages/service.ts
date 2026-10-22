import type { DatabaseSync } from "../db/sqlite.js";
import {
  AuthorizationService,
  type TrustedIdentity,
} from "../security/authorization.js";
import {
  ConversationService,
  type ConversationRecord,
} from "../conversations/service.js";
import { transaction } from "../db/repository.js";
import { EventService } from "../events/service.js";

export type MessageReferenceType = "project" | "conversation" | "agent";

export type MessageReferenceInput = {
  type: MessageReferenceType;
  id: string;
  [key: string]: unknown;
};

export type MessageReference = {
  type: MessageReferenceType;
  id: string;
};

export type MessageRecord = {
  id: string;
  conversationId: string;
  authorType: "agent" | "human" | "system";
  authorId: string;
  text: string;
  references: MessageReference[];
  createdAt: string;
};

export type SendMessageInput = {
  id: string;
  conversationId: string;
  identity: TrustedIdentity;
  text: string;
  references?: readonly MessageReferenceInput[];
  idempotencyKey: string;
  correlationId?: string;
  /** Valeur issue d'une enveloppe non fiable ; elle ne devient jamais l'auteur. */
  untrustedAuthorId?: string;
};

export type ListMessagesInput = {
  conversationId: string;
  identity: TrustedIdentity;
  limit?: number;
  before?: string;
};

export type MessagePage = {
  items: MessageRecord[];
  nextCursor?: string;
};

export class MessageServiceError extends Error {
  constructor(
    public readonly code:
      "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
    message: string,
  ) {
    super(message);
    this.name = "MessageServiceError";
  }
}

type MessageRow = {
  id: string;
  conversationId: string;
  authorType: "agent" | "human" | "system";
  authorId: string;
  text: string;
  messageReferences: string;
  createdAt: string;
};

type CreationRequestRow = {
  idempotencyKey: string;
  messageId: string;
  requestFingerprint: string;
};

type Cursor = {
  createdAt: string;
  id: string;
};

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new MessageServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): Cursor | undefined {
  if (value === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
      typeof (parsed as { id?: unknown }).id !== "string"
    ) {
      throw new Error("invalid cursor");
    }
    return {
      createdAt: requireText(
        (parsed as { createdAt: string }).createdAt,
        "cursor.createdAt",
      ),
      id: requireText((parsed as { id: string }).id, "cursor.id"),
    };
  } catch {
    throw new MessageServiceError("VALIDATION_ERROR", "Invalid message cursor");
  }
}

function normalizeReferences(
  input: readonly MessageReferenceInput[] | undefined,
  conversation: ConversationRecord,
  agentId: string,
  conversations: ConversationService,
  database: DatabaseSync,
): MessageReference[] {
  if (!input) return [];
  if (input.length > 20) {
    throw new MessageServiceError(
      "VALIDATION_ERROR",
      "A message cannot contain more than 20 references",
    );
  }
  const references: MessageReference[] = [];
  const seen = new Set<string>();
  for (const reference of input) {
    if (!reference || typeof reference !== "object") {
      throw new MessageServiceError("VALIDATION_ERROR", "Invalid message reference");
    }
    const type = reference.type;
    if (!(["project", "conversation", "agent"] as string[]).includes(type)) {
      throw new MessageServiceError(
        "VALIDATION_ERROR",
        "Invalid message reference type",
      );
    }
    const id = requireText(reference.id, "reference.id");
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (type === "project" && id !== conversation.projectId) {
      throw new MessageServiceError(
        "FORBIDDEN",
        "Message reference belongs to another project",
      );
    }
    if (type === "conversation") {
      const target = conversations.getConversation(id);
      if (
        !target ||
        target.projectId !== conversation.projectId ||
        !conversations.canAccess({ conversationId: id, agentId })
      ) {
        throw new MessageServiceError(
          "FORBIDDEN",
          "Message reference belongs to an inaccessible conversation",
        );
      }
    }
    if (type === "agent") {
      const member = database
        .prepare("SELECT 1 FROM assignments WHERE project_id = ? AND agent_id = ?")
        .get(conversation.projectId, id);
      if (member === undefined) {
        throw new MessageServiceError(
          "FORBIDDEN",
          "Message reference belongs to another project",
        );
      }
    }
    references.push({ type, id });
  }
  return references;
}

function fingerprint(input: {
  id: string;
  conversationId: string;
  authorType: string;
  authorId: string;
  text: string;
  references: readonly MessageReference[];
}) {
  return JSON.stringify({
    id: input.id,
    conversationId: input.conversationId,
    authorType: input.authorType,
    authorId: input.authorId,
    text: input.text,
    references: input.references,
  });
}

function parseReferences(value: string): MessageReference[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((reference) => {
      if (
        !reference ||
        typeof reference !== "object" ||
        !(["project", "conversation", "agent"] as string[]).includes(
          (reference as { type?: unknown }).type as string,
        ) ||
        typeof (reference as { id?: unknown }).id !== "string"
      ) {
        return [];
      }
      return [
        {
          type: (reference as { type: MessageReferenceType }).type,
          id: (reference as { id: string }).id,
        },
      ];
    });
  } catch {
    return [];
  }
}

export class MessageService {
  private readonly conversations: ConversationService;
  private readonly authorization: AuthorizationService;
  private readonly events: EventService;

  constructor(private readonly database: DatabaseSync) {
    this.conversations = new ConversationService(database);
    this.authorization = new AuthorizationService(database);
    this.events = new EventService(database);
  }

  sendMessage(input: SendMessageInput): MessageRecord {
    return transaction(this.database, () => this.sendMessageWithinTransaction(input));
  }

  /**
   * Persists a message while the caller owns the current transaction. Action
   * bridges use this to commit their domain record and the message together.
   */
  sendMessageWithinTransaction(input: SendMessageInput): MessageRecord {
    const id = requireText(input.id, "id");
    const conversationId = requireText(input.conversationId, "conversationId");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const conversation = this.conversations.getConversation(conversationId);
    if (!conversation) {
      throw new MessageServiceError("NOT_FOUND", "Conversation not found");
    }
    this.conversations.assertAccessible({
      conversationId,
      agentId: input.identity.id,
    });
    this.assertAuthorized(
      conversation,
      input.identity,
      "message.send",
      input.untrustedAuthorId,
    );
    const text = requireText(input.text, "text");
    const references = normalizeReferences(
      input.references,
      conversation,
      input.identity.id,
      this.conversations,
      this.database,
    );
    const requestFingerprint = fingerprint({
      id,
      conversationId,
      authorType: input.identity.type,
      authorId: input.identity.id,
      text,
      references,
    });

    const existingRequest = this.database
      .prepare(
        `
          SELECT
            idempotency_key AS idempotencyKey,
            message_id AS messageId,
            request_fingerprint AS requestFingerprint
          FROM message_creation_requests
          WHERE idempotency_key = ?
        `,
      )
      .get(idempotencyKey) as CreationRequestRow | undefined;
    if (existingRequest) {
      if (existingRequest.requestFingerprint !== requestFingerprint) {
        throw new MessageServiceError(
          "CONFLICT",
          "Idempotency key was already used for another message request",
        );
      }
      return this.readMessage(existingRequest.messageId) as MessageRecord;
    }
    if (this.readMessage(id)) {
      throw new MessageServiceError("CONFLICT", "Message id is already in use");
    }

    this.database
      .prepare(
        `
          INSERT INTO messages
            (id, conversation_id, author_type, author_id, body, message_references)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        conversationId,
        input.identity.type,
        input.identity.id,
        text,
        JSON.stringify(references),
      );
    this.database
      .prepare(
        `
          INSERT INTO message_creation_requests
            (idempotency_key, message_id, request_fingerprint)
          VALUES (?, ?, ?)
        `,
      )
      .run(idempotencyKey, id, requestFingerprint);
    this.events.recordEvent({
      type: "message.posted",
      version: 1,
      projectId: conversation.projectId,
      actor: {
        type: input.identity.type,
        id: input.identity.id,
      },
      correlationId: input.correlationId?.trim() || idempotencyKey,
      causationId: idempotencyKey,
      payload: {
        messageId: id,
        conversationId,
      },
    });
    return this.readMessage(id) as MessageRecord;
  }

  /** Internal lookup used by idempotent server-side action bridges. */
  getMessage(messageIdInput: string): MessageRecord | undefined {
    return this.readMessage(requireText(messageIdInput, "messageId"));
  }

  listMessages(input: ListMessagesInput): MessagePage {
    const conversationId = requireText(input.conversationId, "conversationId");
    const conversation = this.conversations.getConversation(conversationId);
    if (!conversation) {
      throw new MessageServiceError("NOT_FOUND", "Conversation not found");
    }
    this.conversations.assertAccessible({
      conversationId,
      agentId: input.identity.id,
    });
    this.assertAuthorized(conversation, input.identity, "message.read");
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new MessageServiceError(
        "VALIDATION_ERROR",
        "Message limit must be between 1 and 100",
      );
    }
    const before = decodeCursor(input.before);
    const beforeCondition = before
      ? "AND (created_at < ? OR (created_at = ? AND id < ?))"
      : "";
    const parameters: (string | number)[] = [conversationId];
    if (before) parameters.push(before.createdAt, before.createdAt, before.id);
    parameters.push(limit + 1);
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            conversation_id AS conversationId,
            author_type AS authorType,
            author_id AS authorId,
            body AS text,
            message_references AS messageReferences,
            created_at AS createdAt
          FROM messages
          WHERE conversation_id = ?
            ${beforeCondition}
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(...parameters) as MessageRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? encodeCursor({
          createdAt: pageRows[pageRows.length - 1].createdAt,
          id: pageRows[pageRows.length - 1].id,
        })
      : undefined;
    return {
      items: pageRows.reverse().map((row) => this.messageFromRow(row)),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  private assertAuthorized(
    conversation: ConversationRecord,
    identity: TrustedIdentity,
    permission: "message.read" | "message.send",
    untrustedAuthorId?: string,
  ) {
    const decision = this.authorization.authorize({
      projectId: conversation.projectId,
      permission,
      identity,
      untrustedActorId: untrustedAuthorId,
    });
    if (!decision.allowed) {
      throw new MessageServiceError(
        decision.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
        permission === "message.send"
          ? "Message sending is not authorized"
          : "Message reading is not authorized",
      );
    }
  }

  private readMessage(messageId: string): MessageRecord | undefined {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            conversation_id AS conversationId,
            author_type AS authorType,
            author_id AS authorId,
            body AS text,
            message_references AS messageReferences,
            created_at AS createdAt
          FROM messages
          WHERE id = ?
        `,
      )
      .get(messageId) as MessageRow | undefined;
    return row ? this.messageFromRow(row) : undefined;
  }

  private messageFromRow(row: MessageRow): MessageRecord {
    return {
      id: row.id,
      conversationId: row.conversationId,
      authorType: row.authorType,
      authorId: row.authorId,
      text: row.text,
      references: parseReferences(row.messageReferences),
      createdAt: row.createdAt,
    };
  }
}
