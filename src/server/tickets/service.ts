import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import { ConversationService } from "../conversations/service.js";
import { EventService, type EventActor } from "../events/service.js";

export const TICKET_STATES = [
  "todo",
  "in_progress",
  "in_review",
  "done",
  "blocked",
  "cancelled",
] as const;

export type TicketState = (typeof TICKET_STATES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export type TicketRecord = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  authorType: EventActor["type"];
  authorId: string;
  ownerId: string | null;
  priority: TicketPriority;
  acceptanceCriteria: string[];
  state: TicketState;
  blockedFromState: TicketState | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TicketTransitionRecord = {
  id: string;
  ticketId: string;
  fromState: TicketState | null;
  toState: TicketState;
  actorType: EventActor["type"];
  actorId: string;
  reason: string;
  createdAt: string;
};

export type CreateTicketInput = {
  id?: string;
  projectId: string;
  title: string;
  body: string;
  author: EventActor;
  ownerId?: string;
  priority?: string;
  acceptanceCriteria: readonly string[];
  idempotencyKey: string;
  now?: string;
};

export type TransitionTicketInput = {
  ticketId: string;
  nextState: TicketState;
  actor: EventActor;
  idempotencyKey: string;
  reason?: string;
  now?: string;
};

export type AssignTicketInput = {
  ticketId: string;
  ownerId: string;
  actor: EventActor;
  now?: string;
};

export type ListTicketsInput = {
  projectId?: string;
  state?: TicketState;
  ownerId?: string;
};

export type TicketServiceOptions = {
  now?: () => string;
};

export class TicketServiceError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "CONFLICT"
      | "FORBIDDEN"
      | "INVALID_TRANSITION",
    message: string,
  ) {
    super(message);
    this.name = "TicketServiceError";
  }
}

type TicketRow = {
  id: string;
  projectId: string;
  title: string;
  body: string;
  authorType: EventActor["type"];
  authorId: string;
  ownerId: string | null;
  priority: TicketPriority;
  acceptanceCriteria: string;
  state: TicketState;
  blockedFromState: TicketState | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type TransitionRow = {
  id: string;
  ticketId: string;
  fromState: TicketState | null;
  toState: TicketState;
  actorType: EventActor["type"];
  actorId: string;
  reason: string;
  createdAt: string;
};

type RequestRow = {
  idempotencyKey: string;
  ticketId: string;
  transitionId?: string;
  requestFingerprint: string;
};

const TICKET_SELECT = `
  SELECT
    id,
    project_id AS projectId,
    title,
    body,
    author_type AS authorType,
    author_id AS authorId,
    owner_id AS ownerId,
    priority,
    acceptance_criteria AS acceptanceCriteria,
    state,
    blocked_from_state AS blockedFromState,
    blocked_reason AS blockedReason,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM tickets
`;

const TRANSITION_SELECT = `
  SELECT
    id,
    ticket_id AS ticketId,
    from_state AS fromState,
    to_state AS toState,
    actor_type AS actorType,
    actor_id AS actorId,
    reason,
    created_at AS createdAt
  FROM ticket_transitions
`;

const ALLOWED_TRANSITIONS: Record<TicketState, readonly TicketState[]> = {
  todo: ["in_progress", "blocked", "cancelled"],
  in_progress: ["todo", "in_review", "blocked", "cancelled"],
  in_review: ["in_progress", "done", "blocked", "cancelled"],
  done: ["todo"],
  blocked: ["todo", "in_progress", "cancelled"],
  cancelled: [],
};

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new TicketServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function validateTimestamp(value: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new TicketServiceError("VALIDATION_ERROR", "Invalid ticket timestamp");
  }
  return value;
}

function normalizeCriteria(criteria: readonly string[]) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new TicketServiceError(
      "VALIDATION_ERROR",
      "acceptanceCriteria must contain at least one item",
    );
  }
  const normalized = criteria.map((criterion, index) => {
    if (typeof criterion !== "string" || !criterion.trim()) {
      throw new TicketServiceError(
        "VALIDATION_ERROR",
        `acceptanceCriteria[${index}] must not be empty`,
      );
    }
    return criterion.trim();
  });
  return [...new Set(normalized)];
}

function normalizePriority(priority: string | undefined): TicketPriority {
  const value = priority?.trim() || "normal";
  if (!(TICKET_PRIORITIES as readonly string[]).includes(value)) {
    throw new TicketServiceError(
      "VALIDATION_ERROR",
      `Unknown ticket priority: ${value}`,
    );
  }
  return value as TicketPriority;
}

function validateActor(actor: EventActor) {
  const id = requireText(actor.id, "author.id");
  if (!("agent" === actor.type || "human" === actor.type || "system" === actor.type)) {
    throw new TicketServiceError("VALIDATION_ERROR", "Invalid ticket actor type");
  }
  return { type: actor.type, id } as EventActor;
}

function parseCriteria(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (criterion): criterion is string => typeof criterion === "string",
    );
  } catch {
    return [];
  }
}

function toTicket(row: TicketRow): TicketRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    body: row.body,
    authorType: row.authorType,
    authorId: row.authorId,
    ownerId: row.ownerId,
    priority: row.priority,
    acceptanceCriteria: parseCriteria(row.acceptanceCriteria),
    state: row.state,
    blockedFromState: row.blockedFromState,
    blockedReason: row.blockedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTransition(row: TransitionRow): TicketTransitionRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    fromState: row.fromState,
    toState: row.toState,
    actorType: row.actorType,
    actorId: row.actorId,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

function creationFingerprint(input: {
  id: string;
  projectId: string;
  title: string;
  body: string;
  author: EventActor;
  ownerId: string | null;
  priority: TicketPriority;
  acceptanceCriteria: readonly string[];
}) {
  return JSON.stringify(input);
}

function transitionFingerprint(input: {
  ticketId: string;
  nextState: TicketState;
  actor: EventActor;
  reason: string;
}) {
  return JSON.stringify(input);
}

export class TicketService {
  private readonly conversations: ConversationService;
  private readonly events: EventService;
  private readonly now: () => string;

  constructor(
    private readonly database: DatabaseSync,
    options: TicketServiceOptions = {},
  ) {
    this.conversations = new ConversationService(database);
    this.events = new EventService(database);
    this.now = options.now ?? (() => new Date().toISOString());
  }

  createTicket(input: CreateTicketInput): TicketRecord {
    return transaction(this.database, () => this.createTicketWithinTransaction(input));
  }

  /** Persists a ticket while the caller owns the transaction. */
  createTicketWithinTransaction(input: CreateTicketInput): TicketRecord {
    const id = requireText(input.id ?? randomUUID(), "id");
    const projectId = requireText(input.projectId, "projectId");
    const title = requireText(input.title, "title");
    const body = requireText(input.body, "body");
    const author = validateActor(input.author);
    const ownerId = input.ownerId?.trim() || null;
    const priority = normalizePriority(input.priority);
    const acceptanceCriteria = normalizeCriteria(input.acceptanceCriteria);
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const timestamp = validateTimestamp(input.now ?? this.now());
    const requestFingerprint = creationFingerprint({
      id,
      projectId,
      title,
      body,
      author,
      ownerId,
      priority,
      acceptanceCriteria,
    });

    {
      const existing = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              ticket_id AS ticketId,
              request_fingerprint AS requestFingerprint
            FROM ticket_creation_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as RequestRow | undefined;
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new TicketServiceError(
            "CONFLICT",
            "Idempotency key was already used for another ticket request",
          );
        }
        const existingTicket = this.requireTicket(existing.ticketId);
        this.ensureTicketConversation(existingTicket);
        return existingTicket;
      }

      this.assertProjectActive(projectId);
      if (this.getTicket(id)) {
        throw new TicketServiceError("CONFLICT", "Ticket id is already in use");
      }
      this.database
        .prepare(
          `
            INSERT INTO tickets
              (id, project_id, title, body, author_type, author_id, owner_id,
               priority, acceptance_criteria, state, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'todo', ?, ?)
          `,
        )
        .run(
          id,
          projectId,
          title,
          body,
          author.type,
          author.id,
          ownerId,
          priority,
          JSON.stringify(acceptanceCriteria),
          timestamp,
          timestamp,
        );
      this.database
        .prepare(
          `
            INSERT INTO ticket_creation_requests
              (idempotency_key, ticket_id, request_fingerprint)
            VALUES (?, ?, ?)
          `,
        )
        .run(idempotencyKey, id, requestFingerprint);

      const ticket = this.requireTicket(id);
      this.ensureTicketConversation(ticket);
      this.recordTransition(ticket, null, "todo", author, "created", timestamp);
      this.events.recordEvent({
        type: "ticket.created",
        version: 1,
        projectId,
        actor: author,
        correlationId: ticket.id,
        createdAt: timestamp,
        payload: { ticketId: ticket.id, state: ticket.state },
      });
      return ticket;
    }
  }

  getTicket(ticketId: string) {
    const id = requireText(ticketId, "ticketId");
    const row = this.database.prepare(`${TICKET_SELECT} WHERE id = ?`).get(id) as
      TicketRow | undefined;
    return row ? toTicket(row) : undefined;
  }

  requireTicket(ticketId: string) {
    const ticket = this.getTicket(ticketId);
    if (!ticket) throw new TicketServiceError("NOT_FOUND", "Ticket not found");
    return ticket;
  }

  listTickets(input: ListTicketsInput = {}) {
    const conditions = ["1 = 1"];
    const parameters: string[] = [];
    if (input.projectId !== undefined) {
      const projectId = requireText(input.projectId, "projectId");
      this.assertProjectExists(projectId);
      conditions.push("project_id = ?");
      parameters.push(projectId);
    }
    if (input.state !== undefined) {
      if (!TICKET_STATES.includes(input.state)) {
        throw new TicketServiceError("VALIDATION_ERROR", "Unknown ticket state");
      }
      conditions.push("state = ?");
      parameters.push(input.state);
    }
    if (input.ownerId !== undefined) {
      conditions.push("owner_id = ?");
      parameters.push(requireText(input.ownerId, "ownerId"));
    }
    return (
      this.database
        .prepare(
          `${TICKET_SELECT}
           WHERE ${conditions.join(" AND ")}
           ORDER BY created_at, id`,
        )
        .all(...parameters) as TicketRow[]
    ).map(toTicket);
  }

  transitionTicket(input: TransitionTicketInput) {
    return transaction(this.database, () =>
      this.transitionTicketWithinTransaction(input),
    );
  }

  /** Applies a ticket transition while the caller owns the transaction. */
  transitionTicketWithinTransaction(input: TransitionTicketInput) {
    const ticketId = requireText(input.ticketId, "ticketId");
    const nextState = input.nextState;
    if (!TICKET_STATES.includes(nextState)) {
      throw new TicketServiceError("VALIDATION_ERROR", "Unknown ticket state");
    }
    const actor = validateActor(input.actor);
    const idempotencyKey = requireText(input.idempotencyKey, "idempotencyKey");
    const timestamp = validateTimestamp(input.now ?? this.now());

    {
      const current = this.requireTicket(ticketId);
      const reason = input.reason?.trim() || `${current.state}_to_${nextState}`;
      const requestFingerprint = transitionFingerprint({
        ticketId,
        nextState,
        actor,
        reason,
      });
      const existing = this.database
        .prepare(
          `
            SELECT
              idempotency_key AS idempotencyKey,
              ticket_id AS ticketId,
              transition_id AS transitionId,
              request_fingerprint AS requestFingerprint
            FROM ticket_transition_requests
            WHERE idempotency_key = ?
          `,
        )
        .get(idempotencyKey) as RequestRow | undefined;
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new TicketServiceError(
            "CONFLICT",
            "Idempotency key was already used for another ticket transition",
          );
        }
        return this.requireTicket(existing.ticketId);
      }

      if (!ALLOWED_TRANSITIONS[current.state].includes(nextState)) {
        throw new TicketServiceError(
          "INVALID_TRANSITION",
          `Cannot transition ticket from ${current.state} to ${nextState}`,
        );
      }
      if (nextState === "blocked" && !input.reason?.trim()) {
        throw new TicketServiceError(
          "VALIDATION_ERROR",
          "A blocked ticket requires a reason",
        );
      }
      if (current.state === "done" && nextState === "todo" && !input.reason?.trim()) {
        throw new TicketServiceError(
          "VALIDATION_ERROR",
          "Reopening a done ticket requires a reason",
        );
      }

      const blockedFromState = nextState === "blocked" ? current.state : null;
      const blockedReason = nextState === "blocked" ? reason : null;
      this.database
        .prepare(
          `
            UPDATE tickets
            SET state = ?, blocked_from_state = ?, blocked_reason = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .run(nextState, blockedFromState, blockedReason, timestamp, ticketId);
      const transitionId = randomUUID();
      this.recordTransition(
        this.requireTicket(ticketId),
        current.state,
        nextState,
        actor,
        reason,
        timestamp,
        transitionId,
      );
      this.database
        .prepare(
          `
            INSERT INTO ticket_transition_requests
              (idempotency_key, ticket_id, transition_id, request_fingerprint)
            VALUES (?, ?, ?, ?)
          `,
        )
        .run(idempotencyKey, ticketId, transitionId, requestFingerprint);
      this.events.recordEvent({
        type: "ticket.state_changed",
        version: 1,
        projectId: current.projectId,
        actor,
        correlationId: ticketId,
        createdAt: timestamp,
        payload: {
          ticketId,
          fromState: current.state,
          toState: nextState,
          reason,
        },
      });
      return this.requireTicket(ticketId);
    }
  }

  assignTicket(input: AssignTicketInput) {
    return transaction(this.database, () => this.assignTicketWithinTransaction(input));
  }

  /** Assigns a ticket while the caller owns the transaction. */
  assignTicketWithinTransaction(input: AssignTicketInput) {
    const ticketId = requireText(input.ticketId, "ticketId");
    const ownerId = requireText(input.ownerId, "ownerId");
    const actor = validateActor(input.actor);
    const timestamp = validateTimestamp(input.now ?? this.now());
    const current = this.requireTicket(ticketId);
    this.assertProjectActive(current.projectId);

    const owner = this.database
      .prepare("SELECT archived_at AS archivedAt FROM agents WHERE id = ?")
      .get(ownerId) as { archivedAt: string | null } | undefined;
    if (!owner) throw new TicketServiceError("NOT_FOUND", "Owner agent not found");
    if (owner.archivedAt !== null) {
      throw new TicketServiceError("FORBIDDEN", "Archived agents cannot own tickets");
    }
    const assignment = this.database
      .prepare(
        `
          SELECT status
          FROM assignments
          WHERE project_id = ? AND agent_id = ?
          ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC
          LIMIT 1
        `,
      )
      .get(current.projectId, ownerId) as { status: "active" | "archived" } | undefined;
    if (!assignment || assignment.status !== "active") {
      throw new TicketServiceError(
        "FORBIDDEN",
        "Ticket owner must be an active agent assigned to the same project",
      );
    }

    this.database
      .prepare("UPDATE tickets SET owner_id = ?, updated_at = ? WHERE id = ?")
      .run(ownerId, timestamp, ticketId);
    this.events.recordEvent({
      type: "ticket.assigned",
      version: 1,
      projectId: current.projectId,
      actor,
      correlationId: ticketId,
      createdAt: timestamp,
      payload: { ticketId, ownerId },
    });
    return this.requireTicket(ticketId);
  }

  listTransitions(ticketId: string) {
    const id = requireText(ticketId, "ticketId");
    this.requireTicket(id);
    return (
      this.database
        .prepare(`${TRANSITION_SELECT} WHERE ticket_id = ? ORDER BY created_at, id`)
        .all(id) as TransitionRow[]
    ).map(toTransition);
  }

  private recordTransition(
    ticket: TicketRecord,
    fromState: TicketState | null,
    toState: TicketState,
    actor: EventActor,
    reason: string,
    createdAt: string,
    id = randomUUID(),
  ) {
    this.database
      .prepare(
        `
          INSERT INTO ticket_transitions
            (id, ticket_id, from_state, to_state, actor_type, actor_id, reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(id, ticket.id, fromState, toState, actor.type, actor.id, reason, createdAt);
  }

  private ensureTicketConversation(ticket: TicketRecord) {
    this.conversations.createTicketConversationWithinTransaction({
      projectId: ticket.projectId,
      ticketId: ticket.id,
    });
  }

  private assertProjectActive(projectId: string) {
    this.assertProjectExists(projectId);
    const project = this.database
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get(projectId) as { status: "active" | "archived" } | undefined;
    if (project?.status !== "active") {
      throw new TicketServiceError("FORBIDDEN", "Archived projects are not mutable");
    }
  }

  private assertProjectExists(projectId: string) {
    const project = this.database
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get(projectId) as { status: "active" | "archived" } | undefined;
    if (!project) throw new TicketServiceError("NOT_FOUND", "Project not found");
  }
}
