import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import type { DatabaseSync } from "../db/sqlite.js";
import { EventService, eventCursor, type AuditEvent } from "../events/service.js";
import {
  AuthorizationService,
  type TrustedIdentity,
} from "../security/authorization.js";
import { ApiRequestError } from "./api.js";

type EventsQuery = {
  projectId?: string;
  cursor?: string;
  actorId?: string;
  actorType?: string;
  assignmentId?: string;
};

type EventsRequest = FastifyRequest<{ Querystring: EventsQuery }>;

function headerValue(request: FastifyRequest, name: string) {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function queryValue(request: EventsRequest, name: keyof EventsQuery) {
  const rawUrl = request.url || request.raw.url;
  if (rawUrl) {
    const rawValue = new URL(rawUrl, "http://localhost").searchParams.get(name);
    if (rawValue !== null) return rawValue.trim() || undefined;
  }

  const value = request.query?.[name];
  return typeof value === "string" ? value.trim() : undefined;
}

function requiredProjectId(request: EventsRequest) {
  const projectId = queryValue(request, "projectId");
  if (!projectId) {
    throw new ApiRequestError("VALIDATION_ERROR", "projectId is required");
  }
  return projectId;
}

function socketIdentity(request: EventsRequest): TrustedIdentity {
  const id =
    headerValue(request, "x-coderoom-actor-id")?.trim() ??
    queryValue(request, "actorId");
  if (!id) {
    throw new ApiRequestError("UNAUTHORIZED", "Authentication required");
  }
  const type =
    headerValue(request, "x-coderoom-actor-type")?.trim() ??
    queryValue(request, "actorType") ??
    "agent";
  if (type !== "agent" && type !== "human" && type !== "system") {
    throw new ApiRequestError("VALIDATION_ERROR", "Invalid actor type");
  }
  const assignmentId =
    headerValue(request, "x-coderoom-assignment-id")?.trim() ??
    queryValue(request, "assignmentId");
  return {
    type,
    id,
    ...(assignmentId ? { assignmentId } : {}),
  };
}

function eventNotification(event: AuditEvent) {
  return {
    ...event,
    cursor: eventCursor(event),
  };
}

function authorizeSubscription(database: DatabaseSync, request: EventsRequest) {
  const projectId = requiredProjectId(request);
  const identity = socketIdentity(request);
  if (identity.type !== "agent") {
    throw new ApiRequestError("FORBIDDEN", "Agent identity required");
  }
  const decision = new AuthorizationService(database).authorize({
    projectId,
    permission: "project.read",
    identity,
  });
  if (!decision.allowed) {
    throw new ApiRequestError(
      decision.code === "UNAUTHORIZED" ? "UNAUTHORIZED" : "FORBIDDEN",
      "Project access denied",
    );
  }
  return {
    projectId,
    cursor: queryValue(request, "cursor"),
  };
}

export function registerEventWebSocket(app: FastifyInstance, database: DatabaseSync) {
  app.register(websocket, {
    options: {
      maxPayload: 16 * 1024,
      perMessageDeflate: false,
    },
  });

  app.register(async (instance) => {
    const events = new EventService(database);

    instance.get<{ Querystring: EventsQuery }>(
      "/api/events",
      {
        websocket: true,
        preValidation: async (request) => {
          authorizeSubscription(database, request);
        },
      },
      (socket: WebSocket, request: EventsRequest) => {
        const subscription = authorizeSubscription(database, request);
        let cursor = subscription.cursor;
        let closed = false;
        let polling = false;

        const stopPolling = () => {
          closed = true;
          if (pollingTimer) clearInterval(pollingTimer);
        };

        const poll = () => {
          if (closed || polling || socket.readyState !== socket.OPEN) return;
          polling = true;
          try {
            const page = events.listEventsAfter({
              projectId: subscription.projectId,
              after: cursor,
              limit: 100,
            });
            for (const event of page.items) {
              socket.send(JSON.stringify(eventNotification(event)));
              cursor = eventCursor(event);
            }
          } catch {
            socket.close(1011, "Event stream unavailable");
            stopPolling();
          } finally {
            polling = false;
          }
        };

        const pollingTimer = setInterval(poll, 250);
        socket.on("close", stopPolling);
        socket.on("error", stopPolling);

        socket.send(
          JSON.stringify({
            type: "ready",
            projectId: subscription.projectId,
            cursor: cursor ?? null,
          }),
        );
        poll();
      },
    );
  });
}
