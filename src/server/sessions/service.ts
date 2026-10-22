import type { DatabaseSync } from "../db/sqlite.js";
import { transaction } from "../db/repository.js";
import {
  AuthorizationService,
  type TrustedIdentity,
} from "../security/authorization.js";
import { EventService, type EventActor } from "../events/service.js";
import type { CapabilityStatus } from "../agents/service.js";
import type {
  ExecutionSession,
  ExecutionSessionStatus,
  SessionContextScope,
} from "../executions/service.js";

export type PrepareSessionResumeInput = {
  sessionId: string;
  projectId: string;
  assignmentId: string;
  identity: TrustedIdentity;
  nativeResume: CapabilityStatus;
};

export type RevokeSessionOptions = {
  actor?: EventActor;
  now?: string;
};

export class SessionServiceError extends Error {
  constructor(
    public readonly code:
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "CONFLICT"
      | "FORBIDDEN"
      | "CAPABILITY_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "SessionServiceError";
  }
}

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

const SESSION_SELECT = `
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
`;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new SessionServiceError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function validateTimestamp(value: string) {
  if (!value.trim() || Number.isNaN(Date.parse(value))) {
    throw new SessionServiceError("VALIDATION_ERROR", "Invalid session timestamp");
  }
  return value;
}

function parseContextScope(
  value: string,
  fallback: Pick<SessionContextScope, "projectId" | "assignmentId">,
): SessionContextScope {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { projectId?: unknown }).projectId === "string" &&
      typeof (parsed as { assignmentId?: unknown }).assignmentId === "string"
    ) {
      return {
        projectId: (parsed as { projectId: string }).projectId,
        assignmentId: (parsed as { assignmentId: string }).assignmentId,
      };
    }
  } catch {
    // Older sessions fall back to their relational project and assignment.
  }
  return fallback;
}

function toSession(row: SessionRow): ExecutionSession {
  return {
    id: row.id,
    executionId: row.executionId,
    projectId: row.projectId,
    assignmentId: row.assignmentId,
    status: row.status,
    contextScope: parseContextScope(row.contextScope, {
      projectId: row.projectId,
      assignmentId: row.assignmentId,
    }),
    provider: row.provider,
    providerSessionKey: row.providerSessionKey,
    providerVersion: row.providerVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SessionService {
  private readonly eventService: EventService;

  constructor(
    private readonly database: DatabaseSync,
    private readonly authorizationService: AuthorizationService,
    eventService?: EventService,
  ) {
    this.eventService = eventService ?? new EventService(database);
  }

  getSession(sessionIdInput: string): ExecutionSession | undefined {
    const sessionId = requireText(sessionIdInput, "sessionId");
    const row = this.database
      .prepare(`${SESSION_SELECT} WHERE id = ?`)
      .get(sessionId) as SessionRow | undefined;
    return row ? toSession(row) : undefined;
  }

  prepareResume(input: PrepareSessionResumeInput): ExecutionSession {
    const sessionId = requireText(input.sessionId, "sessionId");
    const projectId = requireText(input.projectId, "projectId");
    const assignmentId = requireText(input.assignmentId, "assignmentId");
    const session = this.getSession(sessionId);
    if (
      !session ||
      session.projectId !== projectId ||
      session.assignmentId !== assignmentId ||
      session.contextScope.projectId !== projectId ||
      session.contextScope.assignmentId !== assignmentId
    ) {
      throw new SessionServiceError(
        "FORBIDDEN",
        "Session is not available in this project assignment",
      );
    }
    if (session.status !== "active") {
      throw new SessionServiceError("CONFLICT", "Session is not active");
    }

    try {
      this.authorizationService.assertAuthorized({
        projectId,
        permission: "execution.request",
        identity: input.identity,
        untrustedActorId: input.identity.id,
        untrustedAssignmentId: assignmentId,
        correlationId: session.id,
      });
    } catch {
      throw new SessionServiceError(
        "FORBIDDEN",
        "Identity is not authorized to resume this session",
      );
    }

    if (input.nativeResume !== "supported") {
      throw new SessionServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Native session resume is not verified for this provider",
      );
    }
    return session;
  }

  revokeSession(sessionIdInput: string, options: RevokeSessionOptions = {}) {
    const sessionId = requireText(sessionIdInput, "sessionId");
    const timestamp = validateTimestamp(options.now ?? new Date().toISOString());
    return transaction(this.database, () => {
      const current = this.getSession(sessionId);
      if (!current) {
        throw new SessionServiceError("NOT_FOUND", "Execution session not found");
      }
      if (current.status === "revoked") return current;

      this.database
        .prepare(
          "UPDATE execution_sessions SET status = 'revoked', updated_at = ? WHERE id = ?",
        )
        .run(timestamp, sessionId);
      this.eventService.recordEvent({
        type: "execution.session_revoked",
        version: 1,
        projectId: current.projectId,
        actor: options.actor ?? { type: "system", id: "coderoom" },
        correlationId: current.executionId,
        createdAt: timestamp,
        payload: { sessionId: current.id, assignmentId: current.assignmentId },
      });
      return this.getSession(sessionId) as ExecutionSession;
    });
  }
}
