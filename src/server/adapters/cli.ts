import type { SpawnOptions } from "node:child_process";
import {
  type AdapterCapabilities,
  type AdapterProbe,
  type AgentAdapter,
  type CancelResult,
  type ProviderEvent,
  type ValidatedExecutionRequest,
} from "./contract.js";

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;
const SENSITIVE_KEY =
  /password|secret|token|authorization|api[_-]?key|credential|private[_-]?key/i;
const SENSITIVE_VALUE = /(?:bearer\s+)[a-z0-9._~+/=-]+/gi;

type CliStream = {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
};

export type CliProcess = {
  stdout: CliStream;
  stderr: CliStream;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal?: NodeJS.Signals | number): boolean;
};

export type CliSpawn = (
  executablePath: string,
  args: readonly string[],
  options: SpawnOptions,
) => CliProcess;

export type DecodedCliEvent = {
  type: Exclude<ProviderEvent["type"], "result">;
  data: Record<string, unknown>;
  outputObserved?: boolean;
  completed?: boolean;
};

export type JsonCliDescriptor = {
  provider: string;
  executionArgs: (instruction: string) => readonly string[];
  authArgs?: readonly string[];
  decode: (
    value: Record<string, unknown>,
    request: ValidatedExecutionRequest,
  ) => readonly DecodedCliEvent[];
};

export type JsonCliAdapterOptions = {
  executablePath: string;
  spawn?: CliSpawn;
  environment?: Readonly<Record<string, string>>;
  secretValues?: readonly string[];
  maxOutputBytes?: number;
  probeTimeoutMs?: number;
  now?: () => string;
};

export type CliAdapterErrorCode =
  | "VALIDATION_ERROR"
  | "TOOL_NOT_FOUND"
  | "OUTPUT_MALFORMED"
  | "OUTPUT_TOO_LARGE"
  | "TIMEOUT"
  | "CANCELLED"
  | "EXECUTION_ERROR";

export class CliAdapterError extends Error {
  constructor(
    public readonly code: CliAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CliAdapterError";
  }
}

type RunState = {
  queue: AsyncEventQueue<ProviderEvent>;
  process?: CliProcess;
  cancelled: boolean;
  timedOut: boolean;
  finished: boolean;
  queueClosed: boolean;
  resultEmitted: boolean;
  outputObserved: boolean;
  completionObserved: boolean;
  sequence: number;
  stdoutBytes: number;
  stdoutRemainder: string;
  timeout?: ReturnType<typeof setTimeout>;
};

class AsyncEventQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;
  private failure: Error | undefined;

  push(value: T) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.flush();
  }

  fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    this.flush();
  }

  next(): Promise<IteratorResult<T>> {
    const value = this.values.shift();
    if (value !== undefined) return Promise.resolve({ value, done: false });
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private flush() {
    if (!this.closed || this.values.length > 0) return;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      if (!waiter) continue;
      if (this.failure) waiter.reject(this.failure);
      else waiter.resolve({ value: undefined, done: true });
    }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function eventText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Extract only common textual response fields; arbitrary payloads stay opaque. */
export function findEventText(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || value === undefined) return undefined;
  const direct = eventText(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => findEventText(entry, depth + 1))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? parts.join("") : undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of [
    "text",
    "output_text",
    "content",
    "message",
    "delta",
    "part",
    "output",
    "result",
    "answer",
  ]) {
    const text = findEventText(value[key], depth + 1);
    if (text) return text;
  }
  return undefined;
}

function requireText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0")) {
    throw new CliAdapterError("VALIDATION_ERROR", `${field} must be non-empty`);
  }
  return normalized;
}

function validateTimeout(value: number | undefined, field: string) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < 1) {
    throw new CliAdapterError("VALIDATION_ERROR", `${field} must be positive`);
  }
}

function normalizeCapabilities(
  streaming: AdapterCapabilities["streaming"],
): AdapterCapabilities {
  return {
    streaming,
    nativeResume: "unsupported",
    nativeApproval: "unsupported",
    structuredActions: "unsupported",
  };
}

function redactText(value: string, secretValues: readonly string[]) {
  let redacted = value.replace(SENSITIVE_VALUE, "[REDACTED]");
  for (const secret of secretValues) {
    if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function sanitizeData(
  value: unknown,
  secretValues: readonly string[],
  depth = 0,
): unknown {
  if (depth > 6) return "[TRUNCATED]";
  if (typeof value === "string") return redactText(value, secretValues);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeData(entry, secretValues, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SENSITIVE_KEY.test(key)
          ? "[REDACTED]"
          : sanitizeData(entry, secretValues, depth + 1),
      ]),
    );
  }
  return "[REDACTED]";
}

function parseVersion(output: string) {
  const version = output.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0];
  return version ?? (output.trim().slice(0, 128) || undefined);
}

function processOptions(
  cwd: string | undefined,
  environment: Readonly<Record<string, string>>,
): SpawnOptions {
  return {
    cwd,
    env: { ...environment },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };
}

function buildInstruction(request: ValidatedExecutionRequest) {
  const context = request.contextRefs.length
    ? `\n\nContext references (opaque, read-only):\n${request.contextRefs.map((ref) => `- ${ref}`).join("\n")}`
    : "";
  return `${request.instruction}${context}`;
}

function validateRequest(request: ValidatedExecutionRequest) {
  requireText(request.executionId, "executionId");
  requireText(request.projectId, "projectId");
  requireText(request.assignmentId, "assignmentId");
  requireText(request.triggerId, "triggerId");
  requireText(request.instruction, "instruction");
  if (request.contextRefs.some((ref) => typeof ref !== "string" || !ref.trim())) {
    throw new CliAdapterError(
      "VALIDATION_ERROR",
      "contextRefs must contain non-empty strings",
    );
  }
  if (request.workspacePath !== undefined)
    requireText(request.workspacePath, "workspacePath");
  validateTimeout(request.timeoutMs, "timeoutMs");
}

export class JsonlCliAgentAdapter implements AgentAdapter {
  private readonly options: {
    descriptor: JsonCliDescriptor;
    executablePath: string;
    spawn: CliSpawn;
    environment: Readonly<Record<string, string>>;
    secretValues: readonly string[];
    maxOutputBytes: number;
    probeTimeoutMs: number;
    now: () => string;
  };

  private readonly runs = new Map<string, RunState>();
  private streamingObserved = false;

  constructor(descriptor: JsonCliDescriptor, options: JsonCliAdapterOptions) {
    if (!options.spawn) {
      throw new CliAdapterError(
        "VALIDATION_ERROR",
        `${descriptor.provider} requires an injected runner transport; host processes are not spawned from the container`,
      );
    }
    this.options = {
      descriptor,
      executablePath: requireText(options.executablePath, "executablePath"),
      spawn: options.spawn,
      environment: options.environment ?? {},
      secretValues: options.secretValues ?? [],
      maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      probeTimeoutMs: options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      now: options.now ?? (() => new Date().toISOString()),
    };
    if (
      !Number.isInteger(this.options.maxOutputBytes) ||
      this.options.maxOutputBytes < 1
    ) {
      throw new CliAdapterError("VALIDATION_ERROR", "maxOutputBytes must be positive");
    }
    validateTimeout(this.options.probeTimeoutMs, "probeTimeoutMs");
  }

  async probe(): Promise<AdapterProbe> {
    const version = await this.runProbe(["--version"]);
    if (version.spawnError || version.exitCode !== 0) {
      return {
        provider: this.options.descriptor.provider,
        installed: false,
        authStatus: "unknown",
        capabilities: normalizeCapabilities(
          this.streamingObserved ? "supported" : "unverified",
        ),
      };
    }

    let authStatus: AdapterProbe["authStatus"] = "unknown";
    if (this.options.descriptor.authArgs) {
      const auth = await this.runProbe(this.options.descriptor.authArgs);
      authStatus =
        auth.spawnError || auth.exitCode === undefined
          ? "unknown"
          : auth.exitCode === 0
            ? "ready"
            : "missing";
    }
    return {
      provider: this.options.descriptor.provider,
      executableVersion: parseVersion(version.stdout),
      installed: true,
      authStatus,
      capabilities: normalizeCapabilities(
        this.streamingObserved ? "supported" : "unverified",
      ),
    };
  }

  execute(request: ValidatedExecutionRequest): AsyncIterable<ProviderEvent> {
    validateRequest(request);
    if (!request.workspacePath) {
      throw new CliAdapterError(
        "VALIDATION_ERROR",
        `workspacePath is required for ${this.options.descriptor.provider} execution`,
      );
    }
    if (this.runs.has(request.executionId)) {
      throw new CliAdapterError(
        "VALIDATION_ERROR",
        `Execution already active: ${request.executionId}`,
      );
    }
    const state: RunState = {
      queue: new AsyncEventQueue<ProviderEvent>(),
      cancelled: false,
      timedOut: false,
      finished: false,
      queueClosed: false,
      resultEmitted: false,
      outputObserved: false,
      completionObserved: false,
      sequence: 0,
      stdoutBytes: 0,
      stdoutRemainder: "",
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
    this.terminate(state);
    return { executionHandle: handle, status: "cancelled" };
  }

  private async *run(request: ValidatedExecutionRequest, state: RunState) {
    this.startProcess(request, state);
    try {
      while (true) {
        const next = await state.queue.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      state.finished = true;
      if (!state.queueClosed) this.terminate(state);
      this.runs.delete(request.executionId);
    }
  }

  private startProcess(request: ValidatedExecutionRequest, state: RunState) {
    if (state.cancelled) {
      this.finishCancelled(request, state);
      state.queueClosed = true;
      state.queue.close();
      return;
    }
    let child: CliProcess;
    try {
      child = this.options.spawn(
        this.options.executablePath,
        this.options.descriptor.executionArgs(buildInstruction(request)),
        processOptions(request.workspacePath, this.options.environment),
      );
    } catch (error) {
      state.queue.fail(new CliAdapterError("TOOL_NOT_FOUND", this.errorMessage(error)));
      state.queueClosed = true;
      return;
    }
    state.process = child;
    const timeout = request.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
    state.timeout = setTimeout(() => {
      if (state.finished || state.queueClosed) return;
      state.timedOut = true;
      this.terminate(state);
    }, timeout);
    state.timeout.unref?.();
    child.stdout.on("data", (chunk: Buffer | string) =>
      this.readStdout(request, state, chunk),
    );
    child.stderr.on("data", () => undefined);
    child.on("error", (error) => {
      if (state.queueClosed) return;
      state.queue.fail(
        new CliAdapterError("EXECUTION_ERROR", this.errorMessage(error)),
      );
      state.queueClosed = true;
    });
    child.on("close", (code) => this.finishProcess(request, state, code));
  }

  private readStdout(
    request: ValidatedExecutionRequest,
    state: RunState,
    chunk: Buffer | string,
  ) {
    if (state.queueClosed) return;
    const text = String(chunk);
    state.stdoutBytes += Buffer.byteLength(text);
    if (state.stdoutBytes > this.options.maxOutputBytes) {
      state.queue.fail(
        new CliAdapterError(
          "OUTPUT_TOO_LARGE",
          `${this.options.descriptor.provider} output exceeded the limit`,
        ),
      );
      state.queueClosed = true;
      this.terminate(state);
      return;
    }
    state.stdoutRemainder += text;
    const lines = state.stdoutRemainder.split(/\r?\n/);
    state.stdoutRemainder = lines.pop() ?? "";
    for (const line of lines) this.readLine(request, state, line);
  }

  private readLine(request: ValidatedExecutionRequest, state: RunState, line: string) {
    const trimmed = line.trim();
    if (!trimmed || state.queueClosed) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      state.queue.fail(
        new CliAdapterError(
          "OUTPUT_MALFORMED",
          `${this.options.descriptor.provider} emitted invalid JSONL`,
        ),
      );
      state.queueClosed = true;
      this.terminate(state);
      return;
    }
    if (!isRecord(value) || typeof value.type !== "string") {
      state.queue.fail(
        new CliAdapterError(
          "OUTPUT_MALFORMED",
          `${this.options.descriptor.provider} event must contain a type`,
        ),
      );
      state.queueClosed = true;
      this.terminate(state);
      return;
    }
    let decoded: readonly DecodedCliEvent[];
    try {
      decoded = this.options.descriptor.decode(value, request);
    } catch (error) {
      state.queue.fail(
        new CliAdapterError("OUTPUT_MALFORMED", this.errorMessage(error)),
      );
      state.queueClosed = true;
      this.terminate(state);
      return;
    }
    this.streamingObserved = true;
    for (const event of decoded) {
      if (event.outputObserved) state.outputObserved = true;
      if (event.completed) state.completionObserved = true;
      state.queue.push({
        type: event.type,
        sequence: ++state.sequence,
        occurredAt: this.options.now(),
        data: sanitizeData(event.data, this.options.secretValues) as Record<
          string,
          unknown
        >,
      });
    }
  }

  private finishProcess(
    request: ValidatedExecutionRequest,
    state: RunState,
    code: number | null,
  ) {
    if (state.queueClosed) return;
    if (state.timeout) clearTimeout(state.timeout);
    if (state.stdoutRemainder.trim()) {
      this.readLine(request, state, state.stdoutRemainder);
      state.stdoutRemainder = "";
      if (state.queueClosed) return;
    }
    if (state.cancelled) {
      this.finishCancelled(request, state);
    } else if (state.timedOut) {
      this.finishFailure(
        request,
        state,
        "TIMEOUT",
        `${this.options.descriptor.provider} execution timed out`,
      );
    } else if (code === 0 && (state.outputObserved || state.completionObserved)) {
      this.emitResult(request, state, "succeeded");
    } else {
      this.finishFailure(
        request,
        state,
        "EXECUTION_ERROR",
        code === 0
          ? `${this.options.descriptor.provider} did not emit a completed structured response`
          : `${this.options.descriptor.provider} process failed`,
      );
    }
    state.queueClosed = true;
    state.queue.close();
  }

  private finishCancelled(request: ValidatedExecutionRequest, state: RunState) {
    if (state.resultEmitted) return;
    this.emitTerminal(
      state,
      "CANCELLED",
      `${this.options.descriptor.provider} execution cancelled`,
    );
    this.emitResult(request, state, "cancelled");
  }

  private finishFailure(
    request: ValidatedExecutionRequest,
    state: RunState,
    code: "TIMEOUT" | "EXECUTION_ERROR",
    message: string,
  ) {
    if (state.resultEmitted) return;
    this.emitTerminal(state, code, message);
    this.emitResult(request, state, "failed");
  }

  private emitTerminal(state: RunState, code: string, message: string) {
    state.queue.push({
      type: "error",
      sequence: ++state.sequence,
      occurredAt: this.options.now(),
      data: { code, message: redactText(message, this.options.secretValues) },
    });
  }

  private emitResult(
    request: ValidatedExecutionRequest,
    state: RunState,
    status: "succeeded" | "cancelled" | "failed",
  ) {
    state.queue.push({
      type: "result",
      sequence: ++state.sequence,
      occurredAt: this.options.now(),
      data: { status, executionId: request.executionId },
    });
    state.resultEmitted = true;
  }

  private terminate(state: RunState) {
    if (!state.process) return;
    try {
      state.process.kill("SIGTERM");
    } catch {
      // The host runner remains responsible for the final process-tree kill.
    }
  }

  private async runProbe(args: readonly string[]) {
    let child: CliProcess;
    try {
      child = this.options.spawn(
        this.options.executablePath,
        args,
        processOptions(undefined, this.options.environment),
      );
    } catch (error) {
      return { exitCode: undefined, stdout: "", spawnError: error };
    }
    return new Promise<{
      exitCode: number | null | undefined;
      stdout: string;
      spawnError?: unknown;
    }>((resolve) => {
      let stdout = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // Best effort only for a diagnostic command.
        }
        resolve({ exitCode: undefined, stdout });
      }, this.options.probeTimeoutMs);
      timer.unref?.();
      child.stdout.on("data", (chunk: Buffer | string) => {
        if (Buffer.byteLength(stdout) >= this.options.maxOutputBytes) return;
        stdout += String(chunk);
        stdout = stdout.slice(0, this.options.maxOutputBytes);
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: undefined, stdout, spawnError: error });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code, stdout });
      });
    });
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error && error.message) return redactText(error.message, []);
    return `${this.options.descriptor.provider} process failed`;
  }
}
