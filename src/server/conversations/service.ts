import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";

export type ConversationKind = "main" | "direct" | "ticket";

export type ConversationRecord = {
  id: string;
  projectId: string;
  kind: ConversationKind;
  ticketId: string | null;
  createdAt: string;
};

export type ParticipantRecord = {
  conversationId: string;
  agentId: string;
  joinedAt: string;
};

export type ConversationAggregate = {
  conversation: ConversationRecord;
  participants: ParticipantRecord[];
};

export type CreateDirectConversationInput = {
  id: string;
  projectId: string;
  participantAgentIds: readonly string[];
  idempotencyKey: string;
};

export type CreateTicketConversationInput = {
  id?: string;
  projectId: string;
  ticketId: string;
};

export type ParticipantInput = {
  conversationId: string;
  agentId: string;
};

export type AccessibleConversationsInput = {
  projectId: string;
  agentId: string;
};

export class ConversationServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "ConversationServiceError";
  }
}

type ConversationRow = {
  id: string;
  projectId: string;
  kind: ConversationKind;
  ticketId: string | null;
  createdAt: string;
};

type CreationRequestRow = {
  idempotencyKey: string;
  conversationId: string;
  requestFingerprint: string;
};

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new ConversationServiceError(
      "VALIDATION_ERROR",
      `${field} must not be empty`,
    );
  }
  return normalized;
}

function normalizeParticipantIds(input: readonly string[]) {
  const ids = [
    ...new Set(input.map((agentId) => requireText(agentId, "agentId"))),
  ].sort();
  if (ids.length < 2) {
    throw new ConversationServiceError(
      "VALIDATION_ERROR",
      "A direct conversation requires at least two participants",
    );
  }
  return ids;
}

function fingerprint(input: {
  id: string;
  projectId: string;
  participantAgentIds: readonly string[];
}) {
  return JSON.stringify({
    id: input.id,
    projectId: input.projectId,
    participantAgentIds: input.participantAgentIds,
  });
}

export class ConversationService {
  constructor(private readonly database: DatabaseSync) {}

  createDirectConversation(
    input: CreateDirectConversationInput,
  ): ConversationAggregate {
    const id = requireText(input.id, "id");
    const projectId = requireText(input.projectId, "projectId");
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const participantAgentIds = normalizeParticipantIds(input.participantAgentIds);
    const requestFingerprint = fingerprint({ id, projectId, participantAgentIds });

    return transaction(this.database, () => {
      const existingRequest = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              conversation_id AS conversationId,
              request_fingerprint AS requestFingerprint
            FROM conversation_creation_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as CreationRequestRow | undefined;
      if (existingRequest) {
        if (existingRequest.requestFingerprint !== requestFingerprint) {
          throw new ConversationServiceError(
            "CONFLICT",
            "Idempotency key was already used for another conversation request",
          );
        }
        return this.readAggregate(
          existingRequest.conversationId,
        ) as ConversationAggregate;
      }

      if (this.readConversation(id)) {
        throw new ConversationServiceError(
          "CONFLICT",
          "Conversation id is already in use",
        );
      }
      this.assertProjectActive(projectId);
      for (const agentId of participantAgentIds) {
        this.assertProjectMembership(projectId, agentId);
      }

      this.database
        .prepare(
          `
            INSERT INTO conversations (id, project_id, kind)
            VALUES (?, ?, 'direct')
          `,
        )
        .run(id, projectId);
      const insertParticipant = this.database.prepare(
        "INSERT INTO conversation_participants (conversation_id, agent_id) VALUES (?, ?)",
      );
      for (const agentId of participantAgentIds) {
        insertParticipant.run(id, agentId);
      }
      this.database
        .prepare(
          `
            INSERT INTO conversation_creation_requests
              (idempotency_key, conversation_id, request_fingerprint)
            VALUES (?, ?, ?)
          `,
        )
        .run(idempotencyKey, id, requestFingerprint);
      return this.readAggregate(id) as ConversationAggregate;
    });
  }

  createTicketConversation(
    input: CreateTicketConversationInput,
  ): ConversationAggregate {
    return transaction(this.database, () =>
      this.createTicketConversationWithinTransaction(input),
    );
  }

  /** Creates the ticket conversation while the caller owns the transaction. */
  createTicketConversationWithinTransaction(
    input: CreateTicketConversationInput,
  ): ConversationAggregate {
    const projectId = requireText(input.projectId, "projectId");
    const ticketId = requireText(input.ticketId, "ticketId");
    const id = requireText(input.id ?? `ticket_conversation_${randomUUID()}`, "id");
    this.assertProjectActive(projectId);

    const ticket = this.database
      .prepare("SELECT project_id AS projectId FROM tickets WHERE id = ?")
      .get(ticketId) as { projectId: string } | undefined;
    if (!ticket) {
      throw new ConversationServiceError("NOT_FOUND", "Ticket not found");
    }
    if (ticket.projectId !== projectId) {
      throw new ConversationServiceError(
        "FORBIDDEN",
        "Ticket conversation belongs to another project",
      );
    }

    const existing = this.database
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            kind,
            ticket_id AS ticketId,
            created_at AS createdAt
          FROM conversations
          WHERE kind = 'ticket' AND ticket_id = ?
        `,
      )
      .get(ticketId) as ConversationRow | undefined;
    if (existing) return this.aggregateFromConversation(existing);
    if (this.readConversation(id)) {
      throw new ConversationServiceError(
        "CONFLICT",
        "Conversation id is already in use",
      );
    }

    this.database
      .prepare(
        `
          INSERT INTO conversations (id, project_id, kind, ticket_id)
          VALUES (?, ?, 'ticket', ?)
        `,
      )
      .run(id, projectId, ticketId);
    return this.readAggregate(id) as ConversationAggregate;
  }

  getConversation(conversationIdInput: string): ConversationRecord | undefined {
    return this.readConversation(requireText(conversationIdInput, "conversationId"));
  }

  getTicketConversation(ticketIdInput: string): ConversationAggregate | undefined {
    const ticketId = requireText(ticketIdInput, "ticketId");
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            kind,
            ticket_id AS ticketId,
            created_at AS createdAt
          FROM conversations
          WHERE kind = 'ticket' AND ticket_id = ?
        `,
      )
      .get(ticketId) as ConversationRow | undefined;
    return row ? this.aggregateFromConversation(row) : undefined;
  }

  getMainConversation(projectIdInput: string): ConversationAggregate | undefined {
    const projectId = requireText(projectIdInput, "projectId");
    this.assertProjectExists(projectId);
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            kind,
            ticket_id AS ticketId,
            created_at AS createdAt
          FROM conversations
          WHERE project_id = ? AND kind = 'main'
        `,
      )
      .get(projectId) as ConversationRow | undefined;
    return row ? this.aggregateFromConversation(row) : undefined;
  }

  listAccessibleConversations(
    input: AccessibleConversationsInput,
  ): ConversationRecord[] {
    const projectId = requireText(input.projectId, "projectId");
    const agentId = requireText(input.agentId, "agentId");
    this.assertProjectExists(projectId);
    return this.database
      .prepare(
        `
          SELECT
            c.id,
            c.project_id AS projectId,
            c.kind,
            c.ticket_id AS ticketId,
            c.created_at AS createdAt
          FROM conversations c
          WHERE c.project_id = ?
            AND (
              (
                c.kind IN ('main', 'ticket')
                AND EXISTS (
                  SELECT 1
                  FROM assignments a
                  INNER JOIN agents ag ON ag.id = a.agent_id
                  WHERE a.project_id = c.project_id
                    AND a.agent_id = ?
                    AND a.status = 'active'
                    AND ag.archived_at IS NULL
                )
              )
              OR (
                c.kind = 'direct'
                AND EXISTS (
                  SELECT 1
                  FROM conversation_participants cp
                  INNER JOIN agents ag ON ag.id = cp.agent_id
                  WHERE cp.conversation_id = c.id
                    AND cp.agent_id = ?
                    AND ag.archived_at IS NULL
                )
              )
            )
          ORDER BY c.created_at, c.id
        `,
      )
      .all(projectId, agentId, agentId) as ConversationRecord[];
  }

  listParticipants(conversationIdInput: string): ParticipantRecord[] {
    const conversationId = requireText(conversationIdInput, "conversationId");
    const conversation = this.readConversation(conversationId);
    if (!conversation) {
      throw new ConversationServiceError("NOT_FOUND", "Conversation not found");
    }
    if (conversation.kind === "main" || conversation.kind === "ticket") {
      return this.database
        .prepare(
          `
            SELECT
              ? AS conversationId,
              a.agent_id AS agentId,
              a.created_at AS joinedAt
            FROM assignments a
            INNER JOIN agents ag ON ag.id = a.agent_id
            WHERE a.project_id = ?
              AND a.status = 'active'
              AND ag.archived_at IS NULL
            ORDER BY a.created_at, a.agent_id
          `,
        )
        .all(conversationId, conversation.projectId) as ParticipantRecord[];
    }
    return this.database
      .prepare(
        `
          SELECT
            conversation_id AS conversationId,
            agent_id AS agentId,
            joined_at AS joinedAt
          FROM conversation_participants
          WHERE conversation_id = ?
          ORDER BY joined_at, agent_id
        `,
      )
      .all(conversationId) as ParticipantRecord[];
  }

  addParticipant(input: ParticipantInput): ParticipantRecord {
    const conversationId = requireText(input.conversationId, "conversationId");
    const agentId = requireText(input.agentId, "agentId");
    return transaction(this.database, () => {
      const conversation = this.readConversation(conversationId);
      if (!conversation) {
        throw new ConversationServiceError("NOT_FOUND", "Conversation not found");
      }
      if (conversation.kind !== "direct") {
        throw new ConversationServiceError(
          "FORBIDDEN",
          "Main conversation membership follows project assignments",
        );
      }
      this.assertProjectActive(conversation.projectId);
      this.assertProjectMembership(conversation.projectId, agentId);
      this.database
        .prepare(
          "INSERT OR IGNORE INTO conversation_participants (conversation_id, agent_id) VALUES (?, ?)",
        )
        .run(conversationId, agentId);
      return this.readParticipant(conversationId, agentId) as ParticipantRecord;
    });
  }

  removeParticipant(input: ParticipantInput): void {
    const conversationId = requireText(input.conversationId, "conversationId");
    const agentId = requireText(input.agentId, "agentId");
    transaction(this.database, () => {
      const conversation = this.readConversation(conversationId);
      if (!conversation) {
        throw new ConversationServiceError("NOT_FOUND", "Conversation not found");
      }
      if (conversation.kind !== "direct") {
        throw new ConversationServiceError(
          "FORBIDDEN",
          "Main conversation membership follows project assignments",
        );
      }
      this.assertProjectActive(conversation.projectId);
      this.database
        .prepare(
          "DELETE FROM conversation_participants WHERE conversation_id = ? AND agent_id = ?",
        )
        .run(conversationId, agentId);
    });
  }

  canAccess(input: ParticipantInput): boolean {
    const conversationId = requireText(input.conversationId, "conversationId");
    const agentId = requireText(input.agentId, "agentId");
    const conversation = this.readConversation(conversationId);
    if (!conversation || !this.isProjectMember(conversation.projectId, agentId)) {
      return false;
    }
    if (conversation.kind === "main" || conversation.kind === "ticket") return true;
    return Boolean(this.readParticipant(conversationId, agentId));
  }

  assertAccessible(input: ParticipantInput): ConversationRecord {
    const conversationId = requireText(input.conversationId, "conversationId");
    const agentId = requireText(input.agentId, "agentId");
    const conversation = this.readConversation(conversationId);
    if (!conversation) {
      throw new ConversationServiceError("NOT_FOUND", "Conversation not found");
    }
    if (!this.canAccess({ conversationId, agentId })) {
      throw new ConversationServiceError("FORBIDDEN", "Conversation access denied");
    }
    return conversation;
  }

  private assertProjectExists(projectId: string) {
    const project = this.database
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get(projectId) as { status: "active" | "archived" } | undefined;
    if (!project) {
      throw new ConversationServiceError("NOT_FOUND", "Project not found");
    }
    return project;
  }

  private assertProjectActive(projectId: string) {
    const project = this.assertProjectExists(projectId);
    if (project.status !== "active") {
      throw new ConversationServiceError(
        "FORBIDDEN",
        "Archived projects cannot receive conversation changes",
      );
    }
  }

  private assertProjectMembership(projectId: string, agentId: string) {
    if (!this.isProjectMember(projectId, agentId)) {
      throw new ConversationServiceError(
        "FORBIDDEN",
        "Agent is not an active member of this project",
      );
    }
  }

  private isProjectMember(projectId: string, agentId: string) {
    const membership = this.database
      .prepare(
        `
          SELECT 1
          FROM assignments a
          INNER JOIN agents ag ON ag.id = a.agent_id
          WHERE a.project_id = ?
            AND a.agent_id = ?
            AND a.status = 'active'
            AND ag.archived_at IS NULL
        `,
      )
      .get(projectId, agentId);
    return membership !== undefined;
  }

  private readConversation(conversationId: string): ConversationRecord | undefined {
    return this.database
      .prepare(
        `
          SELECT
            id,
            project_id AS projectId,
            kind,
            ticket_id AS ticketId,
            created_at AS createdAt
          FROM conversations
          WHERE id = ? AND kind IN ('main', 'direct', 'ticket')
        `,
      )
      .get(conversationId) as ConversationRecord | undefined;
  }

  private readAggregate(conversationId: string): ConversationAggregate | undefined {
    const conversation = this.readConversation(conversationId);
    return conversation ? this.aggregateFromConversation(conversation) : undefined;
  }

  private aggregateFromConversation(
    conversation: ConversationRecord,
  ): ConversationAggregate {
    return {
      conversation,
      participants: this.listParticipants(conversation.id),
    };
  }

  private readParticipant(
    conversationId: string,
    agentId: string,
  ): ParticipantRecord | undefined {
    return this.database
      .prepare(
        `
          SELECT
            conversation_id AS conversationId,
            agent_id AS agentId,
            joined_at AS joinedAt
          FROM conversation_participants
          WHERE conversation_id = ? AND agent_id = ?
        `,
      )
      .get(conversationId, agentId) as ParticipantRecord | undefined;
  }
}
