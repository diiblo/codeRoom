import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { ProviderEvent, ValidatedExecutionRequest } from "./contract.js";
import { CodexAgentAdapter, type CodexSpawn } from "./codex.js";

class FakeCodexProcess extends EventEmitter {
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
  executionId: "exec_codex_1",
  projectId: "project_1",
  assignmentId: "assignment_1",
  triggerId: "trigger_1",
  instruction: "Inspect the repository without changing files",
  contextRefs: ["ticket:ticket_1"],
  workspacePath: "/workspaces/project_1",
  timeoutMs: 1_000,
};

async function collect(stream: AsyncIterable<ProviderEvent>) {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function json(type: string, data: Record<string, unknown> = {}) {
  return JSON.stringify({ type, ...data });
}

describe("CodexAgentAdapter", () => {
  it("refuse l'absence de transport injecté depuis le conteneur", () => {
    expect(() => new CodexAgentAdapter({ executablePath: "codex" })).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("détecte la version et le statut de connexion sans lancer de tâche", async () => {
    const calls: Array<{ args: readonly string[]; cwd: string | undefined }> = [];
    const spawn: CodexSpawn = (_file, args, options) => {
      calls.push({ args, cwd: options.cwd as string | undefined });
      const child = new FakeCodexProcess();
      if (args[0] === "--version") child.finish(["codex-cli 1.2.3"]);
      else child.finish(["Logged in with ChatGPT"]);
      return child;
    };
    const adapter = new CodexAgentAdapter({
      executablePath: "C:\\Tools\\codex.exe",
      spawn,
    });

    await expect(adapter.probe()).resolves.toEqual({
      provider: "codex",
      executableVersion: "1.2.3",
      installed: true,
      authStatus: "ready",
      capabilities: {
        streaming: "unverified",
        nativeResume: "unsupported",
        nativeApproval: "unsupported",
        structuredActions: "unsupported",
      },
    });
    expect(calls).toEqual([
      { args: ["--version"], cwd: undefined },
      { args: ["login", "status"], cwd: undefined },
    ]);
  });

  it("normalise le JSONL Codex et impose une commande sans shell", async () => {
    let observed:
      | { file: string; args: readonly string[]; options: Record<string, unknown> }
      | undefined;
    const spawn: CodexSpawn = (file, args, options) => {
      observed = { file, args, options: options as Record<string, unknown> };
      const child = new FakeCodexProcess();
      queueMicrotask(() =>
        child.finish([
          json("thread.started", { thread_id: "thread_1" }),
          json("turn.started"),
          json("item.completed", {
            item: { type: "agent_message", text: "token=top-secret" },
          }),
          json("item.started", {
            item: { type: "command_execution", command: "pwd" },
          }),
          json("turn.completed", { usage: { input_tokens: 12 } }),
        ]),
      );
      return child;
    };
    const adapter = new CodexAgentAdapter({
      executablePath: "/usr/local/bin/codex",
      spawn,
      environment: { CODEX_HOME: "/codex-home" },
      secretValues: ["top-secret"],
      now: () => "2026-10-21T00:00:00.000Z",
    });

    const events = await collect(adapter.execute(request));

    expect(events.map((event) => event.type)).toEqual([
      "session_metadata",
      "session_metadata",
      "output",
      "tool_activity",
      "usage",
      "result",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({ data: { content: "token=[REDACTED]" } }),
    );
    expect(events.at(-1)).toMatchObject({
      type: "result",
      data: { status: "succeeded", executionId: request.executionId },
    });
    expect(observed).toMatchObject({
      file: "/usr/local/bin/codex",
      args: [
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "read-only",
        expect.stringContaining(request.instruction),
      ],
      options: {
        cwd: request.workspacePath,
        shell: false,
        env: { CODEX_HOME: "/codex-home" },
      },
    });

    await expect(adapter.probe()).resolves.toMatchObject({
      capabilities: expect.objectContaining({ streaming: "supported" }),
    });
  });

  it("refuse une sortie non JSONL et un workspace absent", async () => {
    const spawn: CodexSpawn = () => {
      const child = new FakeCodexProcess();
      queueMicrotask(() => child.finish(["plain text"]));
      return child;
    };
    const adapter = new CodexAgentAdapter({ executablePath: "codex", spawn });

    await expect(collect(adapter.execute(request))).rejects.toMatchObject({
      code: "OUTPUT_MALFORMED",
    });
    expect(() => adapter.execute({ ...request, workspacePath: undefined })).toThrow(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });

  it("ne transforme pas un turn interrompu en succès", async () => {
    const spawn: CodexSpawn = () => {
      const child = new FakeCodexProcess();
      queueMicrotask(() =>
        child.finish([json("turn.completed", { turn: { status: "interrupted" } })]),
      );
      return child;
    };
    const adapter = new CodexAgentAdapter({ executablePath: "codex", spawn });

    const events = await collect(adapter.execute(request));

    expect(
      events.some(
        (event) => event.type === "result" && event.data.status === "succeeded",
      ),
    ).toBe(false);
    expect(events.at(-1)).toMatchObject({
      type: "result",
      data: { status: "failed", executionId: request.executionId },
    });
  });

  it("annule l'exécution et rend le timeout observable", async () => {
    const processes: FakeCodexProcess[] = [];
    const spawn: CodexSpawn = () => {
      const child = new FakeCodexProcess();
      processes.push(child);
      return child;
    };
    const adapter = new CodexAgentAdapter({ executablePath: "codex", spawn });
    const stream = adapter.execute(request);
    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next();

    await expect(adapter.cancel(request.executionId)).resolves.toEqual({
      executionHandle: request.executionId,
      status: "cancelled",
    });
    await expect(pending).resolves.toMatchObject({
      value: { type: "error", data: { code: "CANCELLED" } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "result", data: { status: "cancelled" } },
    });
    expect(processes[0]?.killed).toBe(true);

    const timeoutAdapter = new CodexAgentAdapter({ executablePath: "codex", spawn });
    const timeoutEvents = await collect(
      timeoutAdapter.execute({ ...request, executionId: "exec_timeout", timeoutMs: 5 }),
    );
    expect(
      timeoutEvents.some(
        (event) => event.type === "error" && event.data.code === "TIMEOUT",
      ),
    ).toBe(true);
    expect(timeoutEvents.at(-1)).toMatchObject({
      type: "result",
      data: { status: "failed" },
    });
  });
});
