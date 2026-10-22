import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import {
  ConversationService,
  type ConversationRecord,
} from "../conversations/service.js";
import { EventService } from "../events/service.js";
import {
  ExecutionService,
  ExecutionServiceError,
  type ExecutionRecord,
} from "../executions/service.js";
import type { MessageRecord } from "../messages/service.js";

export type MentionTriggerKind = "mention";

export type MentionCandidate = {
  targetAgentId: string;
  triggerKind: MentionTriggerKind;
};

export type MentionIntentionStatus = "queued" | "rejected";

export type MentionRejectionReason =
  | "agent_auto_mention_disabled"
  | "recipient_absent"
  | "recipient_archived"
  | "assignment_inactive"
  | "conversation_membership_required"
  | "project_archived"
  | "provider_unavailable"
  | "assignment_busy";

export type MentionIntention = {
  id: string;
  messageId: string;
  projectId: string;
  conversationId: string;
  targetAgentId: string;
  triggerKind: MentionTriggerKind;
  status: MentionIntentionStatus;
  assignmentId: string | null;
  executionId: string | null;
  reason: MentionRejectionReason | null;
  createdAt: string;
};

export type RouteMessageResult = {
  messageId: string;
  intentions: MentionIntention[];
};

export class MentionRoutingServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "MentionRoutingServiceError";
  }
}

type MentionIntentionRow = {
  id: string;
  messageId: string;
  projectId: string;
  conversationId: string;
  targetAgentId: string;
  triggerKind: MentionTriggerKind;
  status: MentionIntentionStatus;
  assignmentId: string | null;
  executionId: string | null;
  reason: MentionRejectionReason | null;
  createdAt: string;
};

type RecipientRow = {
  assignmentId: string;
  assignmentStatus: "active" | "archived";
  assignmentArchivedAt: string | null;
  agentArchivedAt: string | null;
  projectStatus: "active" | "archived";
  providerStatus: string | null;
};

const MENTION_PATTERN = /(^|[^\p{L}\p{N}_])@([A-Za-z0-9][A-Za-z0-9._-]{0,63})/gu;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new MentionRoutingServiceError(
      "VALIDATION_ERROR",
      `${field} must not be empty`,
    );
  }
  return normalized;
}

function parseAgentReferences(message: MessageRecord) {
  return message.references
    .filter((reference) => reference.type === "agent")
    .map((reference) => reference.id)
    .filter((agentId) => agentId.trim().length > 0);
}

/**
 * Extracts explicit agent ids from prose. `@tous` is intentionally ignored:
 * it is a notification marker and never an execution trigger.
 */
export function parseMentions(text: string): MentionCandidate[] {
  if (!text.trim()) return [];
  const candidates: MentionCandidate[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const targetAgentId = match[2];
    if (targetAgentId.toLocaleLowerCase() === "tous") continue;
    if (seen.has(targetAgentId)) continue;
    seen.add(targetAgentId);
    candidates.push({ targetAgentId, triggerKind: "mention" });
  }
  return candidates;
}

function targetAgentIds(message: MessageRecord) {
  const candidates = [
    ...parseMentions(message.text),
    ...parseAgentReferences(message).map((targetAgentId) => ({
      targetAgentId,
      triggerKind: "mention" as const,
    })),
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (candidate.targetAgentId.toLocaleLowerCase() === "tous") return false;
    if (seen.has(candidate.targetAgentId)) return false;
    seen.add(candidate.targetAgentId);
    return true;
  });
}

function isRecipientParticipant(
  database: DatabaseSync,
  conversation: ConversationRecord,
  agentId: string,
) {
  if (conversation.kind === "main" || conversation.kind === "ticket") return true;
  return (
    database
      .prepare(
        `
          SELECT 1
          FROM conversation_participants
          WHERE conversation_id = ? AND agent_id = ?
        `,
      )
      .get(conversation.id, agentId) !== undefined
  );
}

function rejectionReason(
  recipient: RecipientRow | undefined,
  isParticipant: boolean,
): MentionRejectionReason | null {
  if (!recipient) return "recipient_absent";
  if (recipient.projectStatus !== "active") return "project_archived";
  if (recipient.agentArchivedAt !== null) return "recipient_archived";
  if (
    recipient.assignmentStatus !== "active" ||
    recipient.assignmentArchivedAt !== null
  ) {
    return "assignment_inactive";
  }
  if (!isParticipant) return "conversation_membership_required";
  if (recipient.providerStatus !== "available") return "provider_unavailable";
  return null;
}

export class MentionRoutingService {
  private readonly conversations: ConversationService;
  private readonly events: EventService;
  private readonly executions: ExecutionService;

  constructor(private readonly database: DatabaseSync) {
    this.conversations = new ConversationService(database);
    this.events = new EventService(database);
    this.executions = new ExecutionService(database);
  }

  /**
   * Routes the durable message once. The intention and the queued execution
   * are committed together so a retry cannot leave a half-routed mention.
   */
  routeMessage(messageIdInput: string): RouteMessageResult {
    const messageId = requireText(messageIdInput, "messageId");
    const message = this.readMessage(messageId);
    if (!message) {
      throw new MentionRoutingServiceError("NOT_FOUND", "Message not found");
    }
    const conversation = this.conversations.getConversation(message.conversationId);
    if (!conversation) {
      throw new MentionRoutingServiceError("NOT_FOUND", "Conversation not found");
    }
    const candidates = targetAgentIds(message);
    if (candidates.length === 0) return { messageId, intentions: [] };

    return transaction(this.database, () => {
      const intentions = candidates.map((candidate) =>
        this.routeCandidate(message, conversation, candidate),
      );
      return { messageId, intentions };
    });
  }

  listIntentions(messageIdInput: string): MentionIntention[] {
    const messageId = requireText(messageIdInput, "messageId");
    return this.database
      .prepare(
        `
          SELECT
            id,
            message_id AS messageId,
            project_id AS projectId,
            conversation_id AS conversationId,
            target_agent_id AS targetAgentId,
            trigger_kind AS triggerKind,
            status,
            assignment_id AS assignmentId,
            execution_id AS executionId,
            reason,
            created_at AS createdAt
          FROM mention_intentions
          WHERE message_id = ?
          ORDER BY created_at, id
        `,
      )
      .all(messageId) as MentionIntentionRow[];
  }

  private routeCandidate(
    message: MessageRecord,
    conversation: ConversationRecord,
    candidate: MentionCandidate,
  ) {
    const existing = this.readIntention(
      message.id,
      candidate.targetAgentId,
      candidate.triggerKind,
    );
    if (existing) return existing;

    const recipient = this.readRecipient(
      conversation.projectId,
      candidate.targetAgentId,
    );
    const participant = recipient
      ? isRecipientParticipant(this.database, conversation, candidate.targetAgentId)
      : false;
    const reason =
      message.authorType === "agent"
        ? "agent_auto_mention_disabled"
        : rejectionReason(recipient, participant);
    if (reason) {
      return this.insertRejectedIntention({
        message,
        conversation,
        candidate,
        assignmentId: recipient?.assignmentId ?? null,
        reason,
      });
    }
    if (!recipient) {
      throw new MentionRoutingServiceError(
        "NOT_FOUND",
        "Mention recipient assignment disappeared during routing",
      );
    }

    let execution: ExecutionRecord;
    try {
      execution = this.executions.enqueueWithinTransaction({
        projectId: conversation.projectId,
        assignmentId: recipient.assignmentId,
        triggerId: `mention:${message.id}:${candidate.targetAgentId}`,
        instruction: message.text,
        contextRefs: [
          `project:${conversation.projectId}`,
          `conversation:${conversation.id}`,
          `message:${message.id}`,
        ],
        idempotencyKey: `mention:${message.id}:${candidate.targetAgentId}`,
        actor: {
          type: message.authorType,
          id: message.authorId,
        },
      });
    } catch (error) {
      if (error instanceof ExecutionServiceError && error.code === "CONFLICT") {
        return this.insertRejectedIntention({
          message,
          conversation,
          candidate,
          assignmentId: recipient?.assignmentId ?? null,
          reason: "assignment_busy",
        });
      }
      throw error;
    }

    const intentionId = randomUUID();
    this.database
      .prepare(
        `
          INSERT INTO mention_intentions
            (id, message_id, project_id, conversation_id, target_agent_id,
             trigger_kind, status, assignment_id, execution_id)
          VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)
        `,
      )
      .run(
        intentionId,
        message.id,
        conversation.projectId,
        conversation.id,
        candidate.targetAgentId,
        candidate.triggerKind,
        recipient.assignmentId,
        execution.id,
      );
    const intention = this.readIntentionById(intentionId) as MentionIntention;
    this.events.recordEvent({
      type: "mention.routed",
      version: 1,
      projectId: conversation.projectId,
      actor: { type: message.authorType, id: message.authorId },
      correlationId: message.id,
      causationId: message.id,
      payload: {
        messageId: message.id,
        conversationId: conversation.id,
        targetAgentId: candidate.targetAgentId,
        intentionId,
        executionId: execution.id,
      },
    });
    return intention;
  }

  private insertRejectedIntention(input: {
    message: MessageRecord;
    conversation: ConversationRecord;
    candidate: MentionCandidate;
    assignmentId: string | null;
    reason: MentionRejectionReason;
  }) {
    const intentionId = randomUUID();
    this.database
      .prepare(
        `
          INSERT INTO mention_intentions
            (id, message_id, project_id, conversation_id, target_agent_id,
             trigger_kind, status, assignment_id, reason)
          VALUES (?, ?, ?, ?, ?, ?, 'rejected', ?, ?)
        `,
      )
      .run(
        intentionId,
        input.message.id,
        input.conversation.projectId,
        input.conversation.id,
        input.candidate.targetAgentId,
        input.candidate.triggerKind,
        input.assignmentId,
        input.reason,
      );
    const intention = this.readIntentionById(intentionId) as MentionIntention;
    this.events.recordEvent({
      type: "mention.rejected",
      version: 1,
      projectId: input.conversation.projectId,
      actor: { type: input.message.authorType, id: input.message.authorId },
      correlationId: input.message.id,
      causationId: input.message.id,
      payload: {
        messageId: input.message.id,
        conversationId: input.conversation.id,
        targetAgentId: input.candidate.targetAgentId,
        intentionId,
        reason: input.reason,
      },
    });
    return intention;
  }

  private readRecipient(projectId: string, agentId: string) {
    return this.database
      .prepare(
        `
          SELECT
            a.id AS assignmentId,
            a.status AS assignmentStatus,
            a.archived_at AS assignmentArchivedAt,
            ag.archived_at AS agentArchivedAt,
            p.status AS projectStatus,
            pr.status AS providerStatus
          FROM assignments a
          INNER JOIN agents ag ON ag.id = a.agent_id
          INNER JOIN projects p ON p.id = a.project_id
          LEFT JOIN providers pr ON pr.provider = ag.provider
          WHERE a.project_id = ? AND a.agent_id = ?
          ORDER BY CASE WHEN a.status = 'active' THEN 0 ELSE 1 END,
                   a.created_at DESC, a.id
          LIMIT 1
        `,
      )
      .get(projectId, agentId) as RecipientRow | undefined;
  }

  private readIntention(
    messageId: string,
    targetAgentId: string,
    triggerKind: MentionTriggerKind,
  ) {
    return this.database
      .prepare(
        `
          SELECT
            id,
            message_id AS messageId,
            project_id AS projectId,
            conversation_id AS conversationId,
            target_agent_id AS targetAgentId,
            trigger_kind AS triggerKind,
            status,
            assignment_id AS assignmentId,
            execution_id AS executionId,
            reason,
            created_at AS createdAt
          FROM mention_intentions
          WHERE message_id = ? AND target_agent_id = ? AND trigger_kind = ?
        `,
      )
      .get(messageId, targetAgentId, triggerKind) as MentionIntentionRow | undefined;
  }

  private readIntentionById(id: string) {
    return this.database
      .prepare(
        `
          SELECT
            id,
            message_id AS messageId,
            project_id AS projectId,
            conversation_id AS conversationId,
            target_agent_id AS targetAgentId,
            trigger_kind AS triggerKind,
            status,
            assignment_id AS assignmentId,
            execution_id AS executionId,
            reason,
            created_at AS createdAt
          FROM mention_intentions
          WHERE id = ?
        `,
      )
      .get(id) as MentionIntentionRow | undefined;
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
      .get(messageId) as
      | {
          id: string;
          conversationId: string;
          authorType: MessageRecord["authorType"];
          authorId: string;
          text: string;
          messageReferences: string;
          createdAt: string;
        }
      | undefined;
    if (!row) return undefined;
    let references: MessageRecord["references"] = [];
    try {
      const parsed: unknown = JSON.parse(row.messageReferences);
      if (Array.isArray(parsed)) {
        references = parsed.flatMap((reference) => {
          if (
            !reference ||
            typeof reference !== "object" ||
            !["project", "conversation", "agent"].includes(
              (reference as { type?: unknown }).type as string,
            ) ||
            typeof (reference as { id?: unknown }).id !== "string"
          ) {
            return [];
          }
          return [
            {
              type: (reference as { type: MessageRecord["references"][number]["type"] })
                .type,
              id: (reference as { id: string }).id,
            },
          ];
        });
      }
    } catch {
      references = [];
    }
    return {
      id: row.id,
      conversationId: row.conversationId,
      authorType: row.authorType,
      authorId: row.authorId,
      text: row.text,
      references,
      createdAt: row.createdAt,
    };
  }
}

export const MentionService = MentionRoutingService;
