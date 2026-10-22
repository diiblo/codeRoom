import type { RunnerRequest } from "./gate.js";

const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_STREAM_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;
const ALLOWED_BROKER_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "host.docker.internal",
]);

export type HostBrokerTool = {
  /** Provider identifier from the host broker's registered tool catalog. */
  id: string;
  executablePath: string;
  source: "explicit" | "known-path" | "path";
};

export type HostBrokerDiscoveryRequest = {
  requestId?: string;
  codexPath?: string;
  antigravityPath?: string;
  opencodePath?: string;
};

export type HostBrokerDiscovery = {
  version: "windows-discovery-v1";
  platform: "windows";
  architecture: "x64";
  tools: readonly HostBrokerTool[];
  missing: readonly string[];
  execution: "discovery-only";
  requestId: string;
};

export type HostBrokerPlan = {
  version: "coderoom-broker-plan-v1";
  requestId: string;
  platform: "windows";
  architecture: "x64";
  toolId: string;
  executablePath: string;
  cwd: string;
  argv: readonly string[];
  sessionMode: "isolated" | "host-login";
  environmentKeys: readonly string[];
  secretKeys: readonly string[];
  timeoutMs: number;
  shell: false;
  killProcessTree: true;
  allowedNetworkHosts: readonly string[];
  execution: "disabled-until-windows-proof" | "enabled";
};

export type HostBrokerExecutionRequest = RunnerRequest & {
  requestId?: string;
};

export type HostBrokerExecutionFrame =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | {
      type: "completed";
      exitCode: number | null;
      signal?: string;
      status: "succeeded" | "failed" | "timed_out" | "cancelled";
    };

type HostBrokerExecutionStatus = "succeeded" | "failed" | "timed_out" | "cancelled";

export type HostBrokerExecution = {
  frames: AsyncIterable<HostBrokerExecutionFrame>;
  cancel(): void;
};

export type HostBrokerErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_RESPONSE"
  | "REQUEST_TIMEOUT"
  | "UNAVAILABLE"
  | "REMOTE_REJECTED";

export class HostBrokerError extends Error {
  constructor(
    public readonly code: HostBrokerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HostBrokerError";
  }
}

export type HostBrokerClientOptions = {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxStreamBytes?: number;
};

export type HostBrokerDiscoveryClient = Pick<WindowsHostBrokerClient, "discover">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireResponseRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HostBrokerError("INVALID_RESPONSE", "Broker response must be an object");
  }
  return value;
}

function validateExecutionFrame(value: unknown): HostBrokerExecutionFrame {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new HostBrokerError("INVALID_RESPONSE", "Invalid broker execution frame");
  }
  if (value.type === "stdout" || value.type === "stderr") {
    if (typeof value.data !== "string") {
      throw new HostBrokerError(
        "INVALID_RESPONSE",
        "Broker execution output frame must contain text",
      );
    }
    return { type: value.type, data: value.data };
  }
  if (value.type === "completed") {
    const statuses: readonly HostBrokerExecutionStatus[] = [
      "succeeded",
      "failed",
      "timed_out",
      "cancelled",
    ];
    const exitCodeValid = value.exitCode === null || Number.isInteger(value.exitCode);
    if (
      !exitCodeValid ||
      typeof value.status !== "string" ||
      !statuses.includes(value.status as HostBrokerExecutionStatus)
    ) {
      throw new HostBrokerError(
        "INVALID_RESPONSE",
        "Invalid broker execution completion frame",
      );
    }
    return {
      type: "completed",
      exitCode: value.exitCode as number | null,
      signal: typeof value.signal === "string" ? value.signal : undefined,
      status: value.status as HostBrokerExecutionStatus,
    };
  }
  throw new HostBrokerError("INVALID_RESPONSE", "Unknown broker execution frame");
}

async function readBoundedText(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new HostBrokerError("INVALID_RESPONSE", "Broker response is too large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HostBrokerError("INVALID_RESPONSE", "Broker response is too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function validateBaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HostBrokerError("INVALID_CONFIGURATION", "Broker URL is invalid");
  }
  if (url.protocol !== "http:" || !ALLOWED_BROKER_HOSTS.has(url.hostname)) {
    throw new HostBrokerError(
      "INVALID_CONFIGURATION",
      "Broker URL must target an allowed local HTTP host",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function validateToken(value: string) {
  if (value.length < 32 || value.includes("\0")) {
    throw new HostBrokerError(
      "INVALID_CONFIGURATION",
      "Broker token must contain at least 32 safe characters",
    );
  }
  return value;
}

export class WindowsHostBrokerClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxStreamBytes: number;

  constructor(options: HostBrokerClientOptions) {
    if (
      !Number.isInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) ||
      (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) < 1
    ) {
      throw new HostBrokerError("INVALID_CONFIGURATION", "Broker timeout is invalid");
    }
    if (
      !Number.isInteger(options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES) ||
      (options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES) < 1
    ) {
      throw new HostBrokerError(
        "INVALID_CONFIGURATION",
        "Broker response limit is invalid",
      );
    }
    if (
      !Number.isInteger(options.maxStreamBytes ?? DEFAULT_MAX_STREAM_BYTES) ||
      (options.maxStreamBytes ?? DEFAULT_MAX_STREAM_BYTES) < 1
    ) {
      throw new HostBrokerError(
        "INVALID_CONFIGURATION",
        "Broker stream limit is invalid",
      );
    }
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.token = validateToken(options.token);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.maxStreamBytes = options.maxStreamBytes ?? DEFAULT_MAX_STREAM_BYTES;
  }

  async discover(
    request: HostBrokerDiscoveryRequest = {},
  ): Promise<HostBrokerDiscovery> {
    const response = await this.postJson("/v1/discover", request);
    if (
      response.version !== "windows-discovery-v1" ||
      response.platform !== "windows" ||
      response.architecture !== "x64" ||
      response.execution !== "discovery-only" ||
      typeof response.requestId !== "string" ||
      !Array.isArray(response.tools) ||
      !Array.isArray(response.missing)
    ) {
      throw new HostBrokerError(
        "INVALID_RESPONSE",
        "Invalid broker discovery response",
      );
    }
    return response as unknown as HostBrokerDiscovery;
  }

  async plan(request: RunnerRequest): Promise<HostBrokerPlan> {
    const response = await this.postJson("/v1/plan", request);
    if (
      response.version !== "coderoom-broker-plan-v1" ||
      response.platform !== "windows" ||
      response.architecture !== "x64" ||
      !["disabled-until-windows-proof", "enabled"].includes(
        response.execution as string,
      ) ||
      response.shell !== false ||
      response.killProcessTree !== true
    ) {
      throw new HostBrokerError("INVALID_RESPONSE", "Invalid broker plan response");
    }
    return response as unknown as HostBrokerPlan;
  }

  execute(request: HostBrokerExecutionRequest): HostBrokerExecution {
    const controller = new AbortController();
    let cancelled = false;
    const timeoutMs = Math.max(this.timeoutMs, request.timeoutMs + 1_000);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const responsePromise = this.fetchImpl(`${this.baseUrl}/v1/execute`, {
      method: "POST",
      headers: {
        Accept: "application/x-ndjson",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    void responsePromise.catch(() => undefined);

    return {
      frames: this.readExecutionFrames(
        responsePromise,
        controller,
        timer,
        () => cancelled,
      ),
      cancel: () => {
        cancelled = true;
        controller.abort();
      },
    };
  }

  private async *readExecutionFrames(
    responsePromise: Promise<Response>,
    controller: AbortController,
    timer: ReturnType<typeof setTimeout>,
    wasCancelled: () => boolean,
  ): AsyncIterable<HostBrokerExecutionFrame> {
    try {
      let response: Response;
      try {
        response = await responsePromise;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          if (wasCancelled()) return;
          throw new HostBrokerError("REQUEST_TIMEOUT", "Broker execution timed out");
        }
        throw new HostBrokerError("UNAVAILABLE", "Broker execution failed");
      }

      if (!response.ok) {
        let body: Record<string, unknown> = {};
        try {
          body = requireResponseRecord(
            JSON.parse(
              await readBoundedText(response, this.maxResponseBytes),
            ) as unknown,
          );
        } catch (error) {
          if (error instanceof HostBrokerError) throw error;
          throw new HostBrokerError("INVALID_RESPONSE", "Broker returned invalid JSON");
        }
        const errorCode =
          typeof body.error === "string" ? body.error : "remote-rejected";
        throw new HostBrokerError(
          "REMOTE_REJECTED",
          `Broker rejected execution: ${errorCode}`,
        );
      }
      if (!response.body) {
        throw new HostBrokerError(
          "INVALID_RESPONSE",
          "Broker execution response has no stream",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let totalBytes = 0;
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          totalBytes += result.value.byteLength;
          if (totalBytes > this.maxStreamBytes) {
            await reader.cancel();
            throw new HostBrokerError(
              "INVALID_RESPONSE",
              "Broker execution stream is too large",
            );
          }
          buffer += decoder.decode(result.value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            yield validateExecutionFrame(JSON.parse(trimmed) as unknown);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
          yield validateExecutionFrame(JSON.parse(buffer.trim()) as unknown);
        }
      } catch (error) {
        if (error instanceof HostBrokerError) throw error;
        if (error instanceof SyntaxError) {
          throw new HostBrokerError(
            "INVALID_RESPONSE",
            "Broker execution stream contains invalid JSON",
          );
        }
        throw new HostBrokerError("UNAVAILABLE", "Broker execution stream failed");
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearTimeout(timer);
      if (controller.signal.aborted && !wasCancelled()) {
        controller.abort();
      }
    }
  }

  private async postJson(path: string, payload: unknown) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let body: Record<string, unknown>;
      try {
        body = requireResponseRecord(
          JSON.parse(await readBoundedText(response, this.maxResponseBytes)) as unknown,
        );
      } catch (error) {
        if (error instanceof HostBrokerError) throw error;
        throw new HostBrokerError("INVALID_RESPONSE", "Broker returned invalid JSON");
      }
      if (!response.ok) {
        const errorCode =
          typeof body.error === "string" ? body.error : "remote-rejected";
        throw new HostBrokerError(
          "REMOTE_REJECTED",
          `Broker rejected request: ${errorCode}`,
        );
      }
      return body;
    } catch (error) {
      if (error instanceof HostBrokerError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new HostBrokerError("REQUEST_TIMEOUT", "Broker request timed out");
      }
      throw new HostBrokerError("UNAVAILABLE", "Broker request failed");
    } finally {
      clearTimeout(timer);
    }
  }
}
