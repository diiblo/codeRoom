import Fastify from "fastify";
import cors from "@fastify/cors";
import type { DatabaseSync } from "./db/sqlite.js";
import { openDatabase } from "./db/database.js";
import {
  API_ERROR_CODES,
  registerApiRoutes,
  requestCorrelationId,
} from "./http/api.js";
import { registerEventWebSocket } from "./http/events-websocket.js";
import {
  HostBrokerError,
  WindowsHostBrokerClient,
  type HostBrokerDiscoveryClient,
} from "./runner/broker.js";

const ERROR_STATUS: Record<string, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  CAPABILITY_UNAVAILABLE: 409,
  EXECUTION_UNCERTAIN: 409,
  RATE_LIMITED: 429,
};

export type BuildAppOptions = {
  hostBroker?: HostBrokerDiscoveryClient;
};

type HostToolsStatus = {
  state: "unconfigured" | "invalid" | "unavailable" | "connected";
  tools: Array<{ id: string; source: string }>;
  missing: string[];
};

function configuredHostBroker(): HostBrokerDiscoveryClient | undefined {
  const baseUrl = process.env.CODE_ROOM_BROKER_URL?.trim();
  const token = process.env.CODE_ROOM_BROKER_TOKEN?.trim();
  if (!baseUrl && !token) return undefined;
  if (!baseUrl || !token) return undefined;
  try {
    return new WindowsHostBrokerClient({ baseUrl, token });
  } catch {
    return undefined;
  }
}

async function readHostToolsStatus(
  broker: HostBrokerDiscoveryClient | undefined,
  configured: boolean,
): Promise<HostToolsStatus> {
  if (!configured) {
    return {
      state: "unconfigured",
      tools: [],
      missing: [],
    };
  }
  if (!broker) {
    return {
      state: "invalid",
      tools: [],
      missing: [],
    };
  }
  try {
    const discovery = await broker.discover();
    return {
      state: "connected",
      tools: discovery.tools.map(({ id, source }) => ({ id, source })),
      missing: [...discovery.missing],
    };
  } catch (error) {
    if (error instanceof HostBrokerError) {
      return {
        state: "unavailable",
        tools: [],
        missing: [],
      };
    }
    return {
      state: "unavailable",
      tools: [],
      missing: [],
    };
  }
}

export function buildApp(database?: DatabaseSync, options: BuildAppOptions = {}) {
  const appDatabase = database ?? openDatabase(":memory:");
  const ownsDatabase = database === undefined;
  const hostBrokerConfigured =
    options.hostBroker !== undefined ||
    Boolean(process.env.CODE_ROOM_BROKER_TOKEN?.trim());
  const hostBroker = options.hostBroker ?? configuredHostBroker();
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  app.register(cors, {
    origin: [/^http:\/\/(127\.0\.0\.1|localhost):5173$/],
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "OPTIONS"],
  });

  registerEventWebSocket(app, appDatabase);

  app.get("/health", async () => ({
    status: "ok",
  }));

  app.get("/api/v1/status", async () => {
    const hostTools = await readHostToolsStatus(hostBroker, hostBrokerConfigured);
    return {
      name: "CodeRoom",
      mode: "skeleton",
      execution: "disabled",
      configuredTools: hostTools.tools.map(({ id }) => id),
      hostTools,
    };
  });

  registerApiRoutes(app, appDatabase);

  app.setErrorHandler((error, request, reply) => {
    const correlationId = requestCorrelationId(request);
    reply.header("x-correlation-id", correlationId);
    const errorDetails =
      typeof error === "object" && error !== null
        ? (error as {
            code?: unknown;
            message?: unknown;
            statusCode?: unknown;
            validation?: unknown;
          })
        : {};

    const errorCode =
      typeof errorDetails.code === "string" &&
      API_ERROR_CODES.includes(errorDetails.code as (typeof API_ERROR_CODES)[number])
        ? errorDetails.code
        : undefined;
    const validationError = Array.isArray(errorDetails.validation);
    const code = errorCode ?? (validationError ? "VALIDATION_ERROR" : "INTERNAL_ERROR");
    const statusCode = errorCode
      ? ERROR_STATUS[errorCode]
      : validationError || errorDetails.statusCode === 400
        ? 422
        : 500;
    const message = errorCode
      ? String(errorDetails.message ?? "Request failed")
      : validationError
        ? "Invalid request"
        : "Internal server error";

    if (statusCode >= 500) app.log.error(error);
    reply.code(statusCode).send({
      error: {
        code,
        message,
        correlationId,
      },
    });
  });

  if (ownsDatabase) {
    app.addHook("onClose", (_instance, done) => {
      appDatabase.close();
      done();
    });
  }

  return app;
}
