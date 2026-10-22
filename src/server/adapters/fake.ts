import {
  PROVIDER_EVENT_TYPES,
  type AdapterCapabilities,
  type AdapterProbe,
  type AgentAdapter,
  type CancelResult,
  type ProviderEvent,
  type ProviderEventType,
  type ValidatedExecutionRequest,
} from "./contract.js";

export type FakeAdapterStep =
  | {
      kind: "message";
      content: string;
    }
  | {
      kind: "event";
      type: Exclude<ProviderEventType, "output" | "error" | "result">;
      data?: Record<string, unknown>;
    }
  | {
      kind: "pause";
      durationMs: number;
    }
  | {
      kind: "raw";
      value: unknown;
    }
  | {
      kind: "error";
      message: string;
      code?: string;
    };

export type FakeAdapterOptions = {
  provider?: string;
  executableVersion?: string;
  installed?: boolean;
  authStatus?: AdapterProbe["authStatus"];
  capabilities?: Partial<AdapterCapabilities>;
  steps?: readonly FakeAdapterStep[];
  now?: () => string;
};

export type FakeAdapterErrorCode =
  "VALIDATION_ERROR" | "OUTPUT_MALFORMED" | "TIMEOUT" | "EXECUTION_ERROR";

export class FakeAdapterError extends Error {
  constructor(
    public readonly code: FakeAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FakeAdapterError";
  }
}

type RunState = {
  cancelled: boolean;
  finished: boolean;
  cancelWaiters: Set<() => void>;
};

const SENSITIVE_KEY = /password|secret|token|authorization|api[_-]?key|credential/i;
const MAX_DATA_DEPTH = 5;

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new FakeAdapterError("VALIDATION_ERROR", `${field} must not be empty`);
  }
  return normalized;
}

function normalizeCapabilities(capabilities: Partial<AdapterCapabilities> | undefined) {
  return {
    streaming: capabilities?.streaming ?? "unverified",
    nativeResume: capabilities?.nativeResume ?? "unverified",
    nativeApproval: capabilities?.nativeApproval ?? "unverified",
    structuredActions: capabilities?.structuredActions ?? "unverified",
  } satisfies AdapterCapabilities;
}

function sanitizeData(value: unknown, depth = 0): unknown {
  if (depth > MAX_DATA_DEPTH) return "[TRUNCATED]";
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeData(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeData(entry, depth + 1),
      ]),
    );
  }
  return "[REDACTED]";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRawEvent(value: unknown): {
  type: Exclude<ProviderEventType, "output" | "error" | "result">;
  data: Record<string, unknown>;
} {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new FakeAdapterError(
      "OUTPUT_MALFORMED",
      "Fake provider output must contain an event type",
    );
  }
  if (
    !PROVIDER_EVENT_TYPES.includes(value.type as ProviderEventType) ||
    value.type === "output" ||
    value.type === "error" ||
    value.type === "result"
  ) {
    throw new FakeAdapterError(
      "OUTPUT_MALFORMED",
      `Unsupported fake provider event type: ${value.type}`,
    );
  }
  if (!isRecord(value.data)) {
    throw new FakeAdapterError(
      "OUTPUT_MALFORMED",
      "Fake provider event data must be an object",
    );
  }
  return {
    type: value.type as Exclude<ProviderEventType, "output" | "error" | "result">,
    data: value.data,
  };
}

function validateRequest(request: ValidatedExecutionRequest) {
  requireText(request.executionId, "executionId");
  requireText(request.projectId, "projectId");
  requireText(request.assignmentId, "assignmentId");
  requireText(request.triggerId, "triggerId");
  requireText(request.instruction, "instruction");
  if (
    request.contextRefs.some(
      (contextRef) => typeof contextRef !== "string" || !contextRef.trim(),
    )
  ) {
    throw new FakeAdapterError(
      "VALIDATION_ERROR",
      "contextRefs must contain non-empty strings",
    );
  }
  if (
    request.timeoutMs !== undefined &&
    (!Number.isInteger(request.timeoutMs) || request.timeoutMs < 1)
  ) {
    throw new FakeAdapterError(
      "VALIDATION_ERROR",
      "timeoutMs must be a positive integer",
    );
  }
}

export class FakeAgentAdapter implements AgentAdapter {
  private readonly options: {
    provider: string;
    executableVersion: string;
    installed: boolean;
    authStatus: AdapterProbe["authStatus"];
    capabilities?: Partial<AdapterCapabilities>;
    steps: readonly FakeAdapterStep[];
    now: () => string;
  };

  private readonly runs = new Map<string, RunState>();

  constructor(options: FakeAdapterOptions = {}) {
    this.options = {
      provider: options.provider ?? "fake",
      executableVersion: options.executableVersion ?? "fake-1.0.0",
      installed: options.installed ?? true,
      authStatus: options.authStatus ?? "ready",
      steps: options.steps ?? [],
      capabilities: options.capabilities,
      now: options.now ?? (() => new Date().toISOString()),
    };
  }

  async probe(): Promise<AdapterProbe> {
    return {
      provider: this.options.provider,
      executableVersion: this.options.executableVersion,
      installed: this.options.installed,
      authStatus: this.options.authStatus,
      capabilities: normalizeCapabilities(this.options.capabilities),
    };
  }

  execute(request: ValidatedExecutionRequest): AsyncIterable<ProviderEvent> {
    validateRequest(request);
    if (this.runs.has(request.executionId)) {
      throw new FakeAdapterError(
        "VALIDATION_ERROR",
        `Execution already active: ${request.executionId}`,
      );
    }
    const state: RunState = {
      cancelled: false,
      finished: false,
      cancelWaiters: new Set(),
    };
    this.runs.set(request.executionId, state);
    return this.run(request, state);
  }

  async cancel(executionHandle: string): Promise<CancelResult> {
    const handle = requireText(executionHandle, "executionHandle");
    const state = this.runs.get(handle);
    if (!state) return { executionHandle: handle, status: "not-found" };
    if (state.finished || state.cancelled) {
      return { executionHandle: handle, status: "already-finished" };
    }
    state.cancelled = true;
    for (const waiter of state.cancelWaiters) waiter();
    state.cancelWaiters.clear();
    return { executionHandle: handle, status: "cancelled" };
  }

  private async *run(
    request: ValidatedExecutionRequest,
    state: RunState,
  ): AsyncIterable<ProviderEvent> {
    let sequence = 0;
    const startedAt = Date.now();
    const deadline =
      request.timeoutMs === undefined ? undefined : startedAt + request.timeoutMs;

    const event = (
      type: ProviderEventType,
      data: Record<string, unknown>,
    ): ProviderEvent => ({
      type,
      sequence: ++sequence,
      occurredAt: this.options.now(),
      data: sanitizeData(data) as Record<string, unknown>,
    });

    const failure = (code: "TIMEOUT" | "EXECUTION_ERROR", message: string): never => {
      throw new FakeAdapterError(code, message);
    };

    try {
      for (const step of this.options.steps) {
        if (state.cancelled) {
          yield event("error", { code: "CANCELLED", message: "Execution cancelled" });
          yield event("result", {
            status: "cancelled",
            executionId: request.executionId,
          });
          return;
        }
        if (deadline !== undefined && Date.now() >= deadline) {
          yield event("error", { code: "TIMEOUT", message: "Execution timed out" });
          failure("TIMEOUT", "Execution timed out");
        }

        if (step.kind === "pause") {
          if (!Number.isInteger(step.durationMs) || step.durationMs < 0) {
            throw new FakeAdapterError(
              "VALIDATION_ERROR",
              "pause durationMs must be a non-negative integer",
            );
          }
          const waitResult = await this.wait(step.durationMs, state, deadline);
          if (waitResult === "cancelled") {
            yield event("error", {
              code: "CANCELLED",
              message: "Execution cancelled",
            });
            yield event("result", {
              status: "cancelled",
              executionId: request.executionId,
            });
            return;
          }
          if (waitResult === "timeout") {
            yield event("error", { code: "TIMEOUT", message: "Execution timed out" });
            failure("TIMEOUT", "Execution timed out");
          }
          continue;
        }

        if (step.kind === "message") {
          yield event("output", { content: step.content });
          continue;
        }

        if (step.kind === "event") {
          yield event(step.type, step.data ?? {});
          continue;
        }

        if (step.kind === "raw") {
          const normalized = normalizeRawEvent(step.value);
          yield event(normalized.type, normalized.data);
          continue;
        }

        const code = step.code ?? "EXECUTION_ERROR";
        yield event("error", { code, message: step.message });
        failure("EXECUTION_ERROR", step.message);
      }

      yield event("result", { status: "succeeded", executionId: request.executionId });
    } finally {
      state.finished = true;
    }
  }

  private wait(
    durationMs: number,
    state: RunState,
    deadline: number | undefined,
  ): Promise<"done" | "cancelled" | "timeout"> {
    if (state.cancelled) return Promise.resolve("cancelled");
    if (deadline !== undefined && Date.now() >= deadline) {
      return Promise.resolve("timeout");
    }
    return new Promise((resolve) => {
      let settled = false;
      const pauseTimer = setTimeout(() => settle("done"), durationMs);
      const timeoutTimer =
        deadline === undefined
          ? undefined
          : setTimeout(() => settle("timeout"), Math.max(0, deadline - Date.now()));
      const onCancel = () => settle("cancelled");

      const settle = (result: "done" | "cancelled" | "timeout") => {
        if (settled) return;
        settled = true;
        clearTimeout(pauseTimer);
        if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
        state.cancelWaiters.delete(onCancel);
        resolve(result);
      };

      state.cancelWaiters.add(onCancel);
    });
  }
}
