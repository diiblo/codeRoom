import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "../db/sqlite.js";

export const CANONICAL_PERMISSIONS = [
  "project.read",
  "message.read",
  "message.send",
  "ticket.read",
  "ticket.create",
  "ticket.assign",
  "ticket.update",
  "ticket.submit_review",
  "review.submit",
  "execution.request",
  "git.read",
  "git.write_scoped",
] as const;

export type Permission = (typeof CANONICAL_PERMISSIONS)[number];
export type ActorType = "agent" | "human" | "system";

export type TrustedIdentity = {
  type: ActorType;
  id: string;
  assignmentId?: string;
};

export type AuthorizationRequest = {
  projectId: string;
  permission: string;
  identity?: TrustedIdentity;
  /** Valeur non fiable provenant de l'enveloppe cliente ou du modèle. */
  untrustedActorId?: string;
  /** Valeur non fiable provenant de l'enveloppe cliente ou du modèle. */
  untrustedAssignmentId?: string;
  correlationId?: string;
};

export type AuthorizationDecision = {
  decisionId: string;
  occurredAt: string;
  allowed: boolean;
  code: "AUTHORIZED" | "UNAUTHORIZED" | "FORBIDDEN";
  reason:
    | "authorized"
    | "missing_identity"
    | "invalid_request"
    | "unknown_permission"
    | "actor_id_mismatch"
    | "assignment_id_mismatch"
    | "unsupported_identity"
    | "missing_assignment"
    | "assignment_not_found"
    | "assignment_not_active"
    | "project_not_active"
    | "agent_archived"
    | "invalid_permission_set"
    | "permission_not_granted";
  actorType?: ActorType;
  actorId?: string;
  projectId?: string;
  assignmentId?: string;
  permission?: string;
  correlationId?: string;
};

export type AuthorizationDecisionLogger = (decision: AuthorizationDecision) => void;

type AssignmentRow = {
  assignmentId: string;
  projectId: string;
  agentId: string;
  permissionSet: string;
  assignmentStatus: string;
  assignmentArchivedAt: string | null;
  projectStatus: string;
  agentArchivedAt: string | null;
};

function isPermission(value: string): value is Permission {
  return (CANONICAL_PERMISSIONS as readonly string[]).includes(value);
}

function parsePermissionSet(value: string): string[] | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((permission) => typeof permission !== "string")
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export class AuthorizationError extends Error {
  constructor(public readonly decision: AuthorizationDecision) {
    super(
      decision.code === "UNAUTHORIZED" ? "Authentification requise" : "Accès refusé",
    );
    this.name = "AuthorizationError";
  }
}

export class AuthorizationService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly logDecision?: AuthorizationDecisionLogger,
  ) {}

  authorize(request: AuthorizationRequest): AuthorizationDecision {
    const identity = request.identity;
    const base = {
      projectId: request.projectId,
      permission: request.permission,
      correlationId: request.correlationId,
      actorType: identity?.type,
      actorId: identity?.id,
      assignmentId: identity?.assignmentId,
    };

    if (!identity) {
      return this.decide({
        ...base,
        allowed: false,
        code: "UNAUTHORIZED",
        reason: "missing_identity",
      });
    }
    if (!request.projectId || !request.permission || !identity.id) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "invalid_request",
      });
    }
    if (!isPermission(request.permission)) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "unknown_permission",
      });
    }
    if (
      request.untrustedActorId !== undefined &&
      request.untrustedActorId !== identity.id
    ) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "actor_id_mismatch",
      });
    }
    if (
      request.untrustedAssignmentId !== undefined &&
      request.untrustedAssignmentId !== identity.assignmentId
    ) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "assignment_id_mismatch",
      });
    }
    if (identity.type !== "agent") {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "unsupported_identity",
      });
    }
    if (!identity.assignmentId) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "missing_assignment",
      });
    }

    const assignment = this.findAssignment(
      identity.assignmentId,
      identity.id,
      request.projectId,
    );
    if (!assignment) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "assignment_not_found",
      });
    }
    if (
      assignment.assignmentStatus !== "active" ||
      assignment.assignmentArchivedAt !== null
    ) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "assignment_not_active",
      });
    }
    if (assignment.projectStatus !== "active") {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "project_not_active",
      });
    }
    if (assignment.agentArchivedAt !== null) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "agent_archived",
      });
    }

    const permissionSet = parsePermissionSet(assignment.permissionSet);
    if (!permissionSet) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "invalid_permission_set",
      });
    }
    if (!permissionSet.includes(request.permission)) {
      return this.decide({
        ...base,
        allowed: false,
        code: "FORBIDDEN",
        reason: "permission_not_granted",
      });
    }

    return this.decide({
      ...base,
      allowed: true,
      code: "AUTHORIZED",
      reason: "authorized",
    });
  }

  assertAuthorized(request: AuthorizationRequest): AuthorizationDecision {
    const decision = this.authorize(request);
    if (!decision.allowed) throw new AuthorizationError(decision);
    return decision;
  }

  private findAssignment(
    assignmentId: string,
    agentId: string,
    projectId: string,
  ): AssignmentRow | undefined {
    return this.database
      .prepare(
        `
          SELECT
            a.id AS assignmentId,
            a.project_id AS projectId,
            a.agent_id AS agentId,
            a.permission_set AS permissionSet,
            a.status AS assignmentStatus,
            a.archived_at AS assignmentArchivedAt,
            p.status AS projectStatus,
            ag.archived_at AS agentArchivedAt
          FROM assignments a
          INNER JOIN projects p ON p.id = a.project_id
          INNER JOIN agents ag ON ag.id = a.agent_id
          WHERE a.id = ? AND a.agent_id = ? AND a.project_id = ?
        `,
      )
      .get(assignmentId, agentId, projectId) as AssignmentRow | undefined;
  }

  private decide(
    decision: Omit<AuthorizationDecision, "decisionId" | "occurredAt">,
  ): AuthorizationDecision {
    const completeDecision: AuthorizationDecision = {
      ...decision,
      decisionId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };
    this.logDecision?.(completeDecision);
    return completeDecision;
  }
}
