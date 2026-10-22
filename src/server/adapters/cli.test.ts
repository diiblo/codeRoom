import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { CliProcess, CliSpawn } from "./cli.js";
import { AntigravityAgentAdapter } from "./antigravity.js";
import { OpenCodeAgentAdapter } from "./opencode.js";
import type { ProviderEvent, ValidatedExecutionRequest } from "./contract.js";

class FakeCliProcess extends EventEmitter implements CliProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill() {
    this.killed = true;
    queueMicrotask(() => this.emit("close", null, "SIGTERM"));
    return true;
  }

  finish(lines: readonly string[], code = 0) {
    for (const line of lines) this.stdout.write(`${line}\n`);
    setImmediate(() => {
      this.stdout.end();
      this.stderr.end();
      this.emit("close", code, null);
    });
  }
}

const request: ValidatedExecutionRequest = {
  executionId: "exec_cli_1",
  projectId: "project_1",
  assignmentId: "assignment_1",
  triggerId: "trigger_1",
  instruction: "Respond without changing files",
  contextRefs: [],
  workspacePath: "C:\\CodeRoom\\workspaces\\project-1",
  timeoutMs: 1_000,
};

async function collect(stream: AsyncIterable<ProviderEvent>) {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("host CLI adapters", () => {
  it("normalise le flux Antigravity sans activer les permissions dangereuses", async () => {
    let observedArgs: readonly string[] | undefined;
    const spawn: CliSpawn = (_file, args) => {
      observedArgs = args;
      const child = new FakeCliProcess();
      queueMicrotask(() =>
        child.finish([
          JSON.stringify({ type: "session.started", session_id: "session_1" }),
          JSON.stringify({ type: "message", text: "ANTIGRAVITY_OK" }),
          JSON.stringify({ type: "result", text: "done" }),
        ]),
      );
      return child;
    };
    const adapter = new AntigravityAgentAdapter({
      executablePath: "C:\\Tools\\agy.exe",
      spawn,
    });

    const events = await collect(adapter.execute(request));

    expect(events.map((event) => event.type)).toEqual([
      "tool_activity",
      "output",
      "output",
      "result",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ data: { content: "ANTIGRAVITY_OK" } }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "result",
      data: { status: "succeeded", executionId: request.executionId },
    });
    expect(observedArgs).toEqual([
      "--output-format",
      "stream-json",
      "--sandbox",
      "--mode",
      "plan",
      `--print=${request.instruction}`,
    ]);
    expect(observedArgs).not.toContain("--dangerously-skip-permissions");
  });

  it("sonde OpenCode avec le compte local et utilise son format JSON", async () => {
    const calls: readonly string[][] = [];
    const spawn: CliSpawn = (_file, args) => {
      (calls as string[][]).push([...args]);
      const child = new FakeCliProcess();
      if (args[0] === "--version") child.finish(["1.18.15"]);
      else if (args[0] === "auth") child.finish(["[]"]);
      else {
        queueMicrotask(() =>
          child.finish([
            JSON.stringify({ type: "text", part: { text: "OPENCODE_OK" } }),
            JSON.stringify({ type: "step_finish", reason: "stop" }),
          ]),
        );
      }
      return child;
    };
    const adapter = new OpenCodeAgentAdapter({
      executablePath: "C:\\Tools\\opencode.cmd",
      model: "opencode/deepseek-v4.1-flash-free",
      spawn,
    });

    await expect(adapter.probe()).resolves.toMatchObject({
      provider: "opencode",
      executableVersion: "1.18.15",
      installed: true,
      authStatus: "ready",
    });
    const events = await collect(adapter.execute(request));

    expect(events).toContainEqual(
      expect.objectContaining({ data: { content: "OPENCODE_OK" } }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "result",
      data: { status: "succeeded" },
    });
    expect(calls).toEqual([
      ["--version"],
      ["auth", "list", "--format", "json"],
      [
        "run",
        "--format",
        "json",
        "--pure",
        "--model",
        "opencode/deepseek-v4.1-flash-free",
        request.instruction,
      ],
    ]);
  });

  it("refuse une sortie non JSONL et annule le processus hôte", async () => {
    const processes: FakeCliProcess[] = [];
    const spawn: CliSpawn = () => {
      const child = new FakeCliProcess();
      processes.push(child);
      queueMicrotask(() => child.finish(["plain text"]));
      return child;
    };
    const adapter = new OpenCodeAgentAdapter({ executablePath: "opencode", spawn });

    await expect(collect(adapter.execute(request))).rejects.toMatchObject({
      code: "OUTPUT_MALFORMED",
    });

    const cancellable = new OpenCodeAgentAdapter({
      executablePath: "opencode",
      spawn: () => {
        const child = new FakeCliProcess();
        processes.push(child);
        return child;
      },
    });
    const iterator = cancellable
      .execute({ ...request, executionId: "exec_cancel" })
      [Symbol.asyncIterator]();
    const pending = iterator.next();
    await expect(cancellable.cancel("exec_cancel")).resolves.toMatchObject({
      status: "cancelled",
    });
    await expect(pending).resolves.toMatchObject({
      value: { type: "error", data: { code: "CANCELLED" } },
    });
    expect(processes.at(-1)?.killed).toBe(true);
  });
});
