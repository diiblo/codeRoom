import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  HostBrokerExecutionRequest,
  WindowsHostBrokerClient,
} from "../runner/broker.js";
import type { CliProcess, CliSpawn } from "./cli.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

export type BrokerCliSpawnOptions = {
  client: WindowsHostBrokerClient;
  toolId: string;
  executablePath: string;
  workspaceRoot: string;
  workspacePath: string;
  sessionMode?: "isolated" | "host-login";
  explicitSecretKeys?: readonly string[];
  allowedNetworkHosts?: readonly string[];
  timeoutMs?: number;
  requestId?: () => string;
};

class BrokerCliProcess extends EventEmitter implements CliProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  private execution: ReturnType<WindowsHostBrokerClient["execute"]> | undefined;
  private cancelled = false;

  constructor(
    private readonly client: WindowsHostBrokerClient,
    private readonly request: HostBrokerExecutionRequest,
  ) {
    super();
    queueMicrotask(() => void this.start());
  }

  kill(): boolean {
    if (this.cancelled) return false;
    this.cancelled = true;
    this.execution?.cancel();
    return true;
  }

  private async start() {
    let exitCode: number | null = null;
    let signal: NodeJS.Signals | null = null;
    let completed = false;
    try {
      this.execution = this.client.execute(this.request);
      if (this.cancelled) this.execution.cancel();
      for await (const frame of this.execution.frames) {
        if (frame.type === "stdout") {
          this.stdout.write(frame.data.endsWith("\n") ? frame.data : `${frame.data}\n`);
        } else if (frame.type === "stderr") {
          this.stderr.write(frame.data);
        } else {
          completed = true;
          exitCode = frame.exitCode;
          signal = frame.signal ? (frame.signal as NodeJS.Signals) : null;
          if (frame.status === "cancelled" || frame.status === "timed_out") {
            this.cancelled = true;
          }
        }
      }
    } catch (error) {
      if (!this.cancelled) {
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.stdout.end();
      this.stderr.end();
      this.emit("close", completed ? exitCode : null, signal);
    }
  }
}

function environmentFrom(options: SpawnOptions) {
  return Object.fromEntries(
    Object.entries(options.env ?? {}).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
  );
}

export function createBrokerCliSpawn(options: BrokerCliSpawnOptions): CliSpawn {
  const requestId = options.requestId ?? randomUUID;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return (executablePath, args, spawnOptions) => {
    const workspacePath =
      typeof spawnOptions.cwd === "string" ? spawnOptions.cwd : options.workspacePath;
    return new BrokerCliProcess(options.client, {
      requestId: requestId(),
      toolId: options.toolId,
      executablePath: executablePath || options.executablePath,
      workspaceRoot: options.workspaceRoot,
      workspacePath,
      argv: [...args],
      sessionMode: options.sessionMode ?? "isolated",
      environment: environmentFrom(spawnOptions),
      explicitSecretKeys: options.explicitSecretKeys,
      allowedNetworkHosts: options.allowedNetworkHosts ?? [],
      timeoutMs,
    });
  };
}
