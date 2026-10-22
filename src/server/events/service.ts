import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";

export type EventActorType = "agent" | "human" | "system";

export type EventActor = {
  type: EventActorType;
  id: string;
};

export type AuditEvent = {
  id: string;
  type: string;
  version: number;
  projectId: string | null;
  actorType: EventActorType;
  actorId: string;
  correlationId: string;
  causationId: string | null;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type RecordEventInput = {
  id?: string;
  type: string;
  version: number;
  projectId?: string | null;
  actor: EventActor;
  correlationId: string;
  causationId?: string | null;
  createdAt?: string;
  payload?: Record<string, unknown>;
};

export type ListEventsInput = {
  projectId?: string;
  limit?: number;
  before?: string;
};

export type EventPage = {
  items: AuditEvent[];
  nextCursor?: string;
};

export type ListEventsAfterInput = {
  projectId: string;
  after?: string;
  limit?: number;
};

export type PendingEvent = {
  event: AuditEvent;
  attempts: number;
};

export class EventServiceError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "EventServiceError";
  }
}

type Cursor = {
  createdAt: string;
  id: string;
};

type AuditEventRow = {
  id: string;
  type: string;
  version: number;
  projectId: string | null;
  actorType: EventActorType;
  actorId: string;
  correlationId: string;
  causationId: string | null;
  createdAt: string;
  payload: string;
};

type PendingEventRow = AuditEventRow & {
  attempts: number;
};

const SENSITIVE_KEY =
  /password|secret|token|authorization|api[_-]?key|credential|stdout|stderr|raw[_-]?(log|output)|prompt/i;
const MAX_STRING_LENGTH = 10_000;
const MAX_PAYLOAD_DEPTH = 6;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new EventServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function validateLimit(value: number | undefined) {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new EventServiceError(
      "VALIDATION_ERROR",
      "Event limit must be between 1 and 100",
    );
  }
  return limit;
}

function sanitizePayloadValue(value: unknown, depth: number): unknown {
  if (depth > MAX_PAYLOAD_DEPTH) return "[TRUNCATED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizePayloadValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizePayloadValue(entry, depth + 1),
      ]),
    );
  }
  return "[REDACTED]";
}

function sanitizePayload(payload: Record<string, unknown> | undefined) {
  if (payload === undefined) return {};
  if (typeof payload !== "object" || Array.isArray(payload)) {
    throw new EventServiceError("VALIDATION_ERROR", "Event payload must be an object");
  }
  return sanitizePayloadValue(payload, 0) as Record<string, unknown>;
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

function encodeCursor(cursor: Cursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function eventCursor(event: Pick<AuditEvent, "createdAt" | "id">) {
  return encodeCursor({ createdAt: event.createdAt, id: event.id });
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
    throw new EventServiceError("VALIDATION_ERROR", "Invalid event cursor");
  }
}

function eventFromRow(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    projectId: row.projectId,
    actorType: row.actorType,
    actorId: row.actorId,
    correlationId: row.correlationId,
    causationId: row.causationId,
    createdAt: row.createdAt,
    payload: parsePayload(row.payload),
  };
}

export class EventService {
  constructor(private readonly database: DatabaseSync) {}

  /**
   * Appends the audit event and its outbox entry. Call this from the same
   * transaction as the domain mutation; this method deliberately does not
   * open a nested transaction.
   */
  recordEvent(input: RecordEventInput): AuditEvent {
    const id = requireText(input.id ?? randomUUID(), "id");
    const type = requireText(input.type, "type");
    const actorId = requireText(input.actor.id, "actor.id");
    const correlationId = requireText(input.correlationId, "correlationId");
    const projectId = input.projectId?.trim() || null;
    const causationId = input.causationId?.trim() || null;
    const createdAt = input.createdAt?.trim() || new Date().toISOString();
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new EventServiceError(
        "VALIDATION_ERROR",
        "Event version must be a positive integer",
      );
    }
    if (!["agent", "human", "system"].includes(input.actor.type)) {
      throw new EventServiceError("VALIDATION_ERROR", "Invalid event actor type");
    }
    const payload = sanitizePayload(input.payload);

    this.database
      .prepare(
        `
          INSERT INTO audit_events
            (id, event_type, version, project_id, actor_type, actor_id,
             correlation_id, causation_id, payload, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        type,
        input.version,
        projectId,
        input.actor.type,
        actorId,
        correlationId,
        causationId,
        JSON.stringify(payload),
        createdAt,
      );
    this.database.prepare("INSERT INTO event_outbox (event_id) VALUES (?)").run(id);

    return {
      id,
      type,
      version: input.version,
      projectId,
      actorType: input.actor.type,
      actorId,
      correlationId,
      causationId,
      createdAt,
      payload,
    };
  }

  listEvents(input: ListEventsInput = {}): EventPage {
    const limit = validateLimit(input.limit);
    const before = decodeCursor(input.before);
    const conditions = ["1 = 1"];
    const parameters: (string | number)[] = [];
    if (input.projectId !== undefined) {
      conditions.push("project_id = ?");
      parameters.push(requireText(input.projectId, "projectId"));
    }
    if (before) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      parameters.push(before.createdAt, before.createdAt, before.id);
    }
    parameters.push(limit + 1);
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            event_type AS type,
            version,
            project_id AS projectId,
            actor_type AS actorType,
            actor_id AS actorId,
            correlation_id AS correlationId,
            causation_id AS causationId,
            payload,
            created_at AS createdAt
          FROM audit_events
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
      )
      .all(...parameters) as AuditEventRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? eventCursor(pageRows[pageRows.length - 1]) : undefined;
    return {
      items: pageRows.reverse().map(eventFromRow),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  listEventsAfter(input: ListEventsAfterInput): EventPage {
    const projectId = requireText(input.projectId, "projectId");
    const limit = validateLimit(input.limit);
    const after = decodeCursor(input.after);
    const conditions = ["project_id = ?"];
    const parameters: (string | number)[] = [projectId];
    if (after) {
      conditions.push("(created_at > ? OR (created_at = ? AND id > ?))");
      parameters.push(after.createdAt, after.createdAt, after.id);
    }
    parameters.push(limit + 1);
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            event_type AS type,
            version,
            project_id AS projectId,
            actor_type AS actorType,
            actor_id AS actorId,
            correlation_id AS correlationId,
            causation_id AS causationId,
            payload,
            created_at AS createdAt
          FROM audit_events
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at ASC, id ASC
          LIMIT ?
        `,
      )
      .all(...parameters) as AuditEventRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? eventCursor(pageRows[pageRows.length - 1]) : undefined;
    return {
      items: pageRows.map(eventFromRow),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  claimPending(limit = 50, now = new Date().toISOString()): PendingEvent[] {
    const validatedLimit = validateLimit(limit);
    requireText(now, "now");
    return transaction(this.database, () => {
      const rows = this.database
        .prepare(
          `
            SELECT
              e.id,
              e.event_type AS type,
              e.version,
              e.project_id AS projectId,
              e.actor_type AS actorType,
              e.actor_id AS actorId,
              e.correlation_id AS correlationId,
              e.causation_id AS causationId,
              e.payload,
              e.created_at AS createdAt,
              o.attempts
            FROM event_outbox AS o
            INNER JOIN audit_events AS e ON e.id = o.event_id
            WHERE o.published_at IS NULL AND o.available_at <= ?
            ORDER BY o.available_at, o.event_id
            LIMIT ?
          `,
        )
        .all(now, validatedLimit) as PendingEventRow[];

      for (const row of rows) {
        this.database
          .prepare(
            "UPDATE event_outbox SET attempts = attempts + 1 WHERE event_id = ? AND published_at IS NULL",
          )
          .run(row.id);
      }
      return rows.map((row) => ({
        event: eventFromRow(row),
        attempts: row.attempts + 1,
      }));
    });
  }

  markPublished(eventIdInput: string, publishedAt = new Date().toISOString()) {
    const eventId = requireText(eventIdInput, "eventId");
    const existing = this.database
      .prepare("SELECT event_id AS eventId FROM event_outbox WHERE event_id = ?")
      .get(eventId) as { eventId: string } | undefined;
    if (!existing) throw new EventServiceError("NOT_FOUND", "Event not found");
    this.database
      .prepare(
        "UPDATE event_outbox SET published_at = COALESCE(published_at, ?), last_error = NULL WHERE event_id = ?",
      )
      .run(publishedAt, eventId);
  }

  markFailed(
    eventIdInput: string,
    errorInput: string,
    availableAt = new Date().toISOString(),
  ) {
    const eventId = requireText(eventIdInput, "eventId");
    const error = requireText(errorInput, "error").slice(0, 1_000);
    const existing = this.database
      .prepare("SELECT event_id AS eventId FROM event_outbox WHERE event_id = ?")
      .get(eventId) as { eventId: string } | undefined;
    if (!existing) throw new EventServiceError("NOT_FOUND", "Event not found");
    this.database
      .prepare(
        "UPDATE event_outbox SET available_at = ?, last_error = ? WHERE event_id = ? AND published_at IS NULL",
      )
      .run(availableAt, error, eventId);
  }

  pendingCount() {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM event_outbox WHERE published_at IS NULL")
      .get() as { count: number };
    return row.count;
  }
}
