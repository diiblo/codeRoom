import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { DatabaseSync } from "../db/sqlite.js";
import { AgentService } from "../agents/service.js";
import { AssignmentService } from "../assignments/service.js";
import { ConversationService } from "../conversations/service.js";
import { DashboardService } from "../dashboard/service.js";
import { DeliverableService } from "../deliverables/service.js";
import { EventService } from "../events/service.js";
import { ExecutionService, ExecutionServiceError } from "../executions/service.js";
import {
  ApprovalService,
  ApprovalServiceError,
  APPROVAL_STATUSES,
  type ApprovalDecision,
} from "../approvals/service.js";
import { MessageService } from "../messages/service.js";
import { MentionRoutingService } from "../mentions/service.js";
import { ProjectService } from "../projects/service.js";
import {
  ProjectRepositoryService,
  ProjectRepositoryServiceError,
} from "../projects/repository-service.js";
import {
  StructuredTicketActionService,
  TICKET_ACTION_TYPES,
  TicketActionError,
} from "../actions/ticket.js";
import {
  REVIEW_ACTION_TYPES,
  ReviewActionError,
  StructuredReviewActionService,
} from "../actions/review.js";
import { ReviewService, ReviewServiceError } from "../reviews/service.js";
import {
  TICKET_STATES,
  TicketService,
  TicketServiceError,
  type TicketState,
} from "../tickets/service.js";
import {
  AuthorizationError,
  AuthorizationService,
  type TrustedIdentity,
} from "../security/authorization.js";

export const API_ERROR_CODES = [
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "VALIDATION_ERROR",
  "CAPABILITY_UNAVAILABLE",
  "EXECUTION_UNCERTAIN",
  "RATE_LIMITED",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiRequestError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

type ProjectParams = { projectId: string };
type AgentParams = { agentId: string };
type AssignmentParams = { projectId: string };
type ConversationParams = { id: string };
type ExecutionParams = { id: string };
type ApprovalParams = { id: string };
type TicketParams = { ticketId: string };

type JsonObject = Record<string, unknown>;

function headerValue(request: FastifyRequest, name: string) {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function requestCorrelationId(request: FastifyRequest) {
  const value = headerValue(request, "x-correlation-id")?.trim();
  if (value && value.length <= 128) return value;
  return randomUUID();
}

function requireHeader(request: FastifyRequest, name: string) {
  const value = headerValue(request, name)?.trim();
  if (!value) {
    throw new ApiRequestError("VALIDATION_ERROR", `${name} header is required`);
  }
  return value;
}

function requireIdentity(request: FastifyRequest): TrustedIdentity {
  const id = headerValue(request, "x-coderoom-actor-id")?.trim();
  if (!id) {
    throw new ApiRequestError("UNAUTHORIZED", "Authentication required");
  }
  const type = headerValue(request, "x-coderoom-actor-type")?.trim() || "agent";
  if (type !== "agent" && type !== "human" && type !== "system") {
    throw new ApiRequestError("VALIDATION_ERROR", "Invalid actor type");
  }
  const assignmentId = headerValue(request, "x-coderoom-assignment-id")?.trim();
  return {
    type,
    id,
    ...(assignmentId ? { assignmentId } : {}),
  };
}

function requireAgentIdentity(request: FastifyRequest) {
  const identity = requireIdentity(request);
  if (identity.type !== "agent") {
    throw new ApiRequestError("FORBIDDEN", "Agent identity required");
  }
  return identity;
}

function requireObjectBody(request: FastifyRequest): JsonObject {
  const body: unknown = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiRequestError("VALIDATION_ERROR", "Request body must be an object");
  }
  return body as JsonObject;
}

function rejectUnknownFields(body: JsonObject, allowed: readonly string[]) {
  const unknown = Object.keys(body).find((key) => !allowed.includes(key));
  if (unknown) {
    throw new ApiRequestError("VALIDATION_ERROR", `Unknown field: ${unknown}`);
  }
}

function requiredString(body: JsonObject, field: string) {
  const value = body[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiRequestError(
      "VALIDATION_ERROR",
      `${field} must be a non-empty string`,
    );
  }
  return value.trim();
}

function optionalString(body: JsonObject, field: string) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiRequestError("VALIDATION_ERROR", `${field} must be a string`);
  }
  return value.trim();
}

function nullableString(body: JsonObject, field: string) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== "string") {
    throw new ApiRequestError("VALIDATION_ERROR", `${field} must be a string or null`);
  }
  return value === null ? null : value.trim();
}

function requiredStringArray(body: JsonObject, field: string) {
  const value = body[field];
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new ApiRequestError(
      "VALIDATION_ERROR",
      `${field} must be an array of non-empty strings`,
    );
  }
  return value.map((entry) => (entry as string).trim());
}

function optionalBooleanQuery(request: FastifyRequest, field: string) {
  const query = request.query as JsonObject;
  const value = query[field];
  if (value === undefined) return undefined;
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw new ApiRequestError("VALIDATION_ERROR", `${field} must be boolean`);
}

function optionalStringQuery(request: FastifyRequest, field: string) {
  const query = request.query as JsonObject;
  const value = query[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ApiRequestError("VALIDATION_ERROR", `${field} must be a string`);
  }
  return value.trim();
}

function optionalIntegerQuery(request: FastifyRequest, field: string) {
  const value = optionalStringQuery(request, field);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ApiRequestError("VALIDATION_ERROR", `${field} must be an integer`);
  }
  return parsed;
}

function messageReferences(body: JsonObject) {
  const value = body.references;
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((reference) => !reference || typeof reference !== "object")
  ) {
    throw new ApiRequestError("VALIDATION_ERROR", "references must be an array");
  }
  return value as Parameters<MessageService["sendMessage"]>[0]["references"];
}

function projectIdFromParams(request: FastifyRequest<{ Params: ProjectParams }>) {
  const projectId = request.params.projectId?.trim();
  if (!projectId)
    throw new ApiRequestError("VALIDATION_ERROR", "projectId is required");
  return projectId;
}

function conversationIdFromParams(
  request: FastifyRequest<{ Params: ConversationParams }>,
) {
  const conversationId = request.params.id?.trim();
  if (!conversationId) {
    throw new ApiRequestError("VALIDATION_ERROR", "conversation id is required");
  }
  return conversationId;
}

function resourceIdFromParams(
  request: FastifyRequest<{ Params: ExecutionParams | ApprovalParams }>,
  label: string,
) {
  const id = request.params.id?.trim();
  if (!id) throw new ApiRequestError("VALIDATION_ERROR", `${label} is required`);
  return id;
}

function ticketIdFromParams(request: FastifyRequest<{ Params: TicketParams }>) {
  const ticketId = request.params.ticketId?.trim();
  if (!ticketId) throw new ApiRequestError("VALIDATION_ERROR", "ticket id is required");
  return ticketId;
}

function mapDomainError(error: unknown): never {
  if (error instanceof AuthorizationError) {
    throw new ApiRequestError(
      error.decision.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
      error.message,
    );
  }
  if (error instanceof ExecutionServiceError) {
    const code =
      error.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.code === "CONFLICT" ||
            error.code === "INVALID_TRANSITION" ||
            error.code === "LEASE_REQUIRED" ||
            error.code === "LEASE_LOST"
          ? "CONFLICT"
          : "VALIDATION_ERROR";
    throw new ApiRequestError(code, error.message);
  }
  if (error instanceof ApprovalServiceError) {
    throw new ApiRequestError(error.code, error.message);
  }
  if (error instanceof TicketActionError) {
    throw new ApiRequestError(error.code, error.message);
  }
  if (error instanceof ReviewActionError) {
    throw new ApiRequestError(error.code, error.message);
  }
  if (error instanceof ReviewServiceError) {
    throw new ApiRequestError(
      error.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.code === "FORBIDDEN"
          ? "FORBIDDEN"
          : error.code === "CONFLICT"
            ? "CONFLICT"
            : "VALIDATION_ERROR",
      error.message,
    );
  }
  if (error instanceof TicketServiceError) {
    throw new ApiRequestError(
      error.code === "NOT_FOUND"
        ? "NOT_FOUND"
        : error.code === "CONFLICT" || error.code === "INVALID_TRANSITION"
          ? "CONFLICT"
          : error.code === "FORBIDDEN"
            ? "FORBIDDEN"
            : "VALIDATION_ERROR",
      error.message,
    );
  }
  if (error instanceof ProjectRepositoryServiceError) {
    throw new ApiRequestError(error.code, error.message);
  }
  throw error;
}

function requireHumanIdentity(request: FastifyRequest) {
  const identity = requireIdentity(request);
  if (identity.type !== "human") {
    throw new ApiRequestError("FORBIDDEN", "Human identity required");
  }
  return identity;
}

export function registerApiRoutes(app: FastifyInstance, database: DatabaseSync) {
  const projects = new ProjectService(database);
  const agents = new AgentService(database);
  const dashboard = new DashboardService(database);
  const assignments = new AssignmentService(database);
  const conversations = new ConversationService(database);
  const messages = new MessageService(database);
  const mentions = new MentionRoutingService(database);
  const events = new EventService(database);
  const executionService = new ExecutionService(database);
  const approvalService = new ApprovalService(database, { executionService });
  const authorization = new AuthorizationService(database);
  const tickets = new TicketService(database);
  const deliverables = new DeliverableService(database);
  const ticketActions = new StructuredTicketActionService(database);
  const reviewActions = new StructuredReviewActionService(database);
  const reviews = new ReviewService(database);
  const projectRepositories = new ProjectRepositoryService(database);

  app.get("/api/dashboard", async (request) => {
    requireHumanIdentity(request);
    const organizationId = optionalStringQuery(request, "organizationId");
    if (!organizationId) {
      throw new ApiRequestError("VALIDATION_ERROR", "organizationId is required");
    }
    return dashboard.getDashboard(organizationId);
  });

  app.get("/api/projects", async (request) => {
    requireIdentity(request);
    return {
      items: projects.listProjects({
        organizationId: optionalStringQuery(request, "organizationId"),
        includeArchived: optionalBooleanQuery(request, "includeArchived"),
      }),
    };
  });

  app.post("/api/projects", async (request, reply) => {
    requireIdentity(request);
    const body = requireObjectBody(request);
    rejectUnknownFields(body, [
      "id",
      "organizationId",
      "name",
      "description",
      "mainConversationId",
    ]);
    return reply.code(201).send({
      project: projects.createProject({
        id: requiredString(body, "id"),
        organizationId: requiredString(body, "organizationId"),
        name: requiredString(body, "name"),
        description: optionalString(body, "description"),
        mainConversationId: optionalString(body, "mainConversationId"),
        idempotencyKey: requireHeader(request, "Idempotency-Key"),
      }),
    });
  });

  app.get<{ Params: ProjectParams }>("/api/projects/:projectId", async (request) => {
    requireIdentity(request);
    const projectId = projectIdFromParams(request);
    const project = projects
      .listProjects({ includeArchived: true })
      .find((candidate) => candidate.id === projectId);
    if (!project) throw new ApiRequestError("NOT_FOUND", "Project not found");
    return {
      project,
      mainConversation:
        conversations.getMainConversation(projectId)?.conversation ?? null,
    };
  });

  app.patch<{ Params: ProjectParams }>("/api/projects/:projectId", async (request) => {
    requireIdentity(request);
    const body = requireObjectBody(request);
    rejectUnknownFields(body, ["name", "description"]);
    const projectId = projectIdFromParams(request);
    return {
      project: projects.updateProject({
        projectId,
        name: optionalString(body, "name"),
        description: nullableString(body, "description"),
      }),
    };
  });

  app.post<{ Params: ProjectParams }>(
    "/api/projects/:projectId/archive",
    async (request) => {
      requireIdentity(request);
      return {
        project: projects.archiveProject(projectIdFromParams(request)),
      };
    },
  );

  app.put<{ Params: ProjectParams }>(
    "/api/projects/:projectId/repository",
    async (request) => {
      const identity = requireHumanIdentity(request);
      const body = requireObjectBody(request);
      rejectUnknownFields(body, ["path"]);
      try {
        return {
          repository: projectRepositories.linkRepository({
            projectId: projectIdFromParams(request),
            path: requiredString(body, "path"),
            idempotencyKey: requireHeader(request, "Idempotency-Key"),
            actor: { type: identity.type, id: identity.id },
            correlationId: requestCorrelationId(request),
          }),
        };
      } catch (error) {
        return mapDomainError(error);
      }
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/tickets",
    async (request) => {
      const identity = requireIdentity(request);
      const projectId = projectIdFromParams(request);
      const state = optionalStringQuery(request, "state");
      if (state !== undefined && !TICKET_STATES.includes(state as TicketState)) {
        throw new ApiRequestError("VALIDATION_ERROR", "Unknown ticket state");
      }
      try {
        if (identity.type === "agent") {
          authorization.assertAuthorized({
            projectId,
            permission: "ticket.read",
            identity,
            correlationId: requestCorrelationId(request),
          });
        } else if (identity.type !== "human") {
          throw new ApiRequestError("FORBIDDEN", "Human or agent identity required");
        }
        return {
          items: tickets.listTickets({
            projectId,
            state: state as TicketState | undefined,
            ownerId: optionalStringQuery(request, "ownerId"),
          }),
        };
      } catch (error) {
        return mapDomainError(error);
      }
    },
  );

  app.get<{ Params: TicketParams }>("/api/tickets/:ticketId", async (request) => {
    const identity = requireIdentity(request);
    const ticketId = ticketIdFromParams(request);
    const ticket = tickets.getTicket(ticketId);
    if (!ticket) throw new ApiRequestError("NOT_FOUND", "Ticket not found");
    try {
      if (identity.type === "agent") {
        authorization.assertAuthorized({
          projectId: ticket.projectId,
          permission: "ticket.read",
          identity,
          correlationId: requestCorrelationId(request),
        });
      } else if (identity.type !== "human") {
        throw new ApiRequestError("FORBIDDEN", "Human or agent identity required");
      }
      return {
        ticket,
        conversation: conversations.getTicketConversation(ticket.id) ?? null,
        deliverables: deliverables.listByTicket(ticket.id),
        reviews: reviews.listReviewsByTicket(ticket.id),
      };
    } catch (error) {
      return mapDomainError(error);
    }
  });

  app.get("/api/agents", async (request) => {
    requireIdentity(request);
    return {
      items: agents.listAgents({
        includeArchived: optionalBooleanQuery(request, "includeArchived"),
        provider: optionalStringQuery(request, "provider"),
      }),
    };
  });

  app.post("/api/agents", async (request, reply) => {
    requireIdentity(request);
    const body = requireObjectBody(request);
    rejectUnknownFields(body, [
      "id",
      "provider",
      "displayName",
      "role",
      "instructions",
      "description",
    ]);
    return reply.code(201).send({
      agent: agents.createAgent({
        id: requiredString(body, "id"),
        provider: optionalString(body, "provider"),
        displayName: requiredString(body, "displayName"),
        role: requiredString(body, "role"),
        instructions: optionalString(body, "instructions"),
        description: optionalString(body, "description"),
      }),
    });
  });

  app.patch<{ Params: AgentParams }>("/api/agents/:agentId", async (request) => {
    requireIdentity(request);
    const body = requireObjectBody(request);
    rejectUnknownFields(body, ["displayName", "role", "instructions", "description"]);
    return {
      agent: agents.updateAgent({
        agentId: request.params.agentId,
        displayName: optionalString(body, "displayName"),
        role: optionalString(body, "role"),
        instructions: optionalString(body, "instructions"),
        description: nullableString(body, "description"),
      }),
    };
  });

  app.post<{ Params: AgentParams }>("/api/agents/:agentId/archive", async (request) => {
    requireIdentity(request);
    if (request.body !== undefined) {
      rejectUnknownFields(requireObjectBody(request), []);
    }
    return { agent: agents.archiveAgent(request.params.agentId) };
  });

  app.post("/api/actions", async (request) => {
    const identity = requireAgentIdentity(request);
    const body = requireObjectBody(request);
    rejectUnknownFields(body, [
      "type",
      "actionId",
      "executionId",
      "projectId",
      "idempotencyKey",
      "payload",
    ]);
    const type = requiredString(body, "type");
    const isTicketAction = (TICKET_ACTION_TYPES as readonly string[]).includes(type);
    const isReviewAction = (REVIEW_ACTION_TYPES as readonly string[]).includes(type);
    if (!isTicketAction && !isReviewAction) {
      throw new ApiRequestError("VALIDATION_ERROR", "Unsupported ticket action type");
    }
    try {
      const action = {
        type,
        actionId: optionalString(body, "actionId"),
        executionId: requiredString(body, "executionId"),
        projectId: requiredString(body, "projectId"),
        idempotencyKey: requiredString(body, "idempotencyKey"),
        payload: body.payload,
      };
      if (isReviewAction) {
        return {
          result: reviewActions.handle({
            action: action as Parameters<
              StructuredReviewActionService["handle"]
            >[0]["action"],
            identity,
            correlationId: requestCorrelationId(request),
          }),
        };
      }
      return {
        result: ticketActions.handle({
          action: {
            ...action,
            type: type as (typeof TICKET_ACTION_TYPES)[number],
          },
          identity,
          correlationId: requestCorrelationId(request),
        }),
      };
    } catch (error) {
      return mapDomainError(error);
    }
  });

  app.post<{ Params: { ticketId: string } }>(
    "/api/tickets/:ticketId/reviews",
    async (request) => {
      const identity = requireHumanIdentity(request);
      const body = requireObjectBody(request);
      rejectUnknownFields(body, ["deliverableId", "decision", "reason"]);
      const decision = requiredString(body, "decision");
      if (decision !== "accepted" && decision !== "rejected") {
        throw new ApiRequestError("VALIDATION_ERROR", "Unknown review decision");
      }
      try {
        return {
          result: reviews.recordReview({
            ticketId: requiredString(request.params, "ticketId"),
            deliverableId: requiredString(body, "deliverableId"),
            actor: { type: "human", id: identity.id },
            decision,
            reason: optionalString(body, "reason"),
            idempotencyKey: requireHeader(request, "Idempotency-Key"),
            correlationId: requestCorrelationId(request),
          }),
        };
      } catch (error) {
        return mapDomainError(error);
      }
    },
  );

  app.get<{ Params: AssignmentParams }>(
    "/api/projects/:projectId/assignments",
    async (request) => {
      requireIdentity(request);
      return {
        items: assignments.listAssignments({
          projectId: projectIdFromParams(request),
          includeArchived: optionalBooleanQuery(request, "includeArchived"),
        }),
      };
    },
  );

  app.post<{ Params: AssignmentParams }>(
    "/api/projects/:projectId/assignments",
    async (request, reply) => {
      requireIdentity(request);
      const body = requireObjectBody(request);
      rejectUnknownFields(body, ["id", "agentId", "provider", "permissionSet"]);
      return reply.code(201).send({
        assignment: assignments.createAssignment({
          id: requiredString(body, "id"),
          projectId: projectIdFromParams(request),
          agentId: requiredString(body, "agentId"),
          provider: optionalString(body, "provider"),
          permissionSet: requiredStringArray(body, "permissionSet"),
          idempotencyKey: requireHeader(request, "Idempotency-Key"),
        }),
      });
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/conversations",
    async (request) => {
      const identity = requireAgentIdentity(request);
      return {
        items: conversations.listAccessibleConversations({
          projectId: projectIdFromParams(request),
          agentId: identity.id,
        }),
      };
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/api/projects/:projectId/conversations",
    async (request, reply) => {
      requireAgentIdentity(request);
      const body = requireObjectBody(request);
      rejectUnknownFields(body, ["id", "participantAgentIds"]);
      return reply.code(201).send({
        conversation: conversations.createDirectConversation({
          id: requiredString(body, "id"),
          projectId: projectIdFromParams(request),
          participantAgentIds: requiredStringArray(body, "participantAgentIds"),
          idempotencyKey: requireHeader(request, "Idempotency-Key"),
        }),
      });
    },
  );

  app.get<{ Params: ConversationParams }>(
    "/api/conversations/:id/messages",
    async (request) => {
      const identity = requireAgentIdentity(request);
      return messages.listMessages({
        conversationId: conversationIdFromParams(request),
        identity,
        limit: optionalIntegerQuery(request, "limit"),
        before: optionalStringQuery(request, "before"),
      });
    },
  );

  app.post<{ Params: ConversationParams }>(
    "/api/conversations/:id/messages",
    async (request, reply) => {
      const identity = requireAgentIdentity(request);
      const body = requireObjectBody(request);
      rejectUnknownFields(body, ["id", "text", "references"]);
      const message = messages.sendMessage({
        id: requiredString(body, "id"),
        conversationId: conversationIdFromParams(request),
        identity,
        text: requiredString(body, "text"),
        references: messageReferences(body),
        idempotencyKey: requireHeader(request, "Idempotency-Key"),
        correlationId: requestCorrelationId(request),
      });
      return reply.code(201).send({
        message,
        routing: mentions.routeMessage(message.id),
      });
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/activity",
    async (request) => {
      const identity = requireAgentIdentity(request);
      const projectId = projectIdFromParams(request);
      if (
        conversations.listAccessibleConversations({
          projectId,
          agentId: identity.id,
        }).length === 0
      ) {
        throw new ApiRequestError("FORBIDDEN", "Project access denied");
      }
      return events.listEvents({
        projectId,
        limit: optionalIntegerQuery(request, "limit"),
        before: optionalStringQuery(request, "cursor"),
      });
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/api/projects/:projectId/executions",
    async (request) => {
      const identity = requireIdentity(request);
      const projectId = projectIdFromParams(request);
      if (
        identity.type === "agent" &&
        conversations.listAccessibleConversations({
          projectId,
          agentId: identity.id,
        }).length === 0
      ) {
        throw new ApiRequestError("FORBIDDEN", "Project access denied");
      }
      try {
        return { items: executionService.listExecutions(projectId) };
      } catch (error) {
        return mapDomainError(error);
      }
    },
  );

  app.post<{ Params: ExecutionParams }>(
    "/api/executions/:id/cancel",
    async (request) => {
      const identity = requireAgentIdentity(request);
      requireHeader(request, "Idempotency-Key");
      const executionId = resourceIdFromParams(request, "execution id");
      try {
        const execution = executionService.requireExecution(executionId);
        if (execution.assignmentId !== identity.assignmentId) {
          throw new ApiRequestError("FORBIDDEN", "Execution access denied");
        }
        authorization.assertAuthorized({
          projectId: execution.projectId,
          permission: "execution.request",
          identity,
          correlationId: requestCorrelationId(request),
        });
        return {
          result: executionService.cancel(executionId, {
            actor: { type: identity.type, id: identity.id },
          }),
        };
      } catch (error) {
        return mapDomainError(error);
      }
    },
  );

  app.get("/api/approvals", async (request) => {
    requireHumanIdentity(request);
    const projectId = optionalStringQuery(request, "projectId");
    if (!projectId) {
      throw new ApiRequestError(
        "VALIDATION_ERROR",
        "projectId query parameter is required",
      );
    }
    const status = optionalStringQuery(request, "status");
    if (status !== undefined && !APPROVAL_STATUSES.includes(status as never)) {
      throw new ApiRequestError("VALIDATION_ERROR", "Unknown approval status");
    }
    try {
      approvalService.reconcilePending();
      return {
        items: approvalService.listApprovals({
          projectId,
          status: status as (typeof APPROVAL_STATUSES)[number] | undefined,
        }),
      };
    } catch (error) {
      return mapDomainError(error);
    }
  });

  app.post<{ Params: ApprovalParams }>(
    "/api/approvals/:id/decision",
    async (request) => {
      const identity = requireHumanIdentity(request);
      requireHeader(request, "Idempotency-Key");
      const body = requireObjectBody(request);
      rejectUnknownFields(body, ["decision", "reason"]);
      const decision = requiredString(body, "decision");
      if (decision !== "approved" && decision !== "denied") {
        throw new ApiRequestError("VALIDATION_ERROR", "Unknown approval decision");
      }
      try {
        return {
          approval: approvalService.decideApproval({
            approvalId: resourceIdFromParams(request, "approval id"),
            decision: decision as ApprovalDecision,
            identity,
            reason: optionalString(body, "reason"),
          }),
        };
      } catch (error) {
        return mapDomainError(error);
      }
    },
  );
}
