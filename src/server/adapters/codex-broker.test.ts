import { describe, expect, it } from "vitest";
import { CodexAgentAdapter } from "./codex.js";
import { createBrokerCodexSpawn } from "./codex-broker.js";
import type { ProviderEvent, ValidatedExecutionRequest } from "./contract.js";
import { WindowsHostBrokerClient } from "../runner/broker.js";

const token = "broker-test-token-012345678901234567890123";
const workspacePath = "C:\\CodeRoom\\workspaces\\project-1";
const request: ValidatedExecutionRequest = {
  executionId: "exec_broker_1",
  projectId: "project_1",
  assignmentId: "assignment_1",
  triggerId: "trigger_1",
  instruction: "Inspect the repository without changing files",
  contextRefs: [],
  workspacePath,
  timeoutMs: 1_000,
};

async function collect(stream: AsyncIterable<ProviderEvent>) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("Codex broker transport", () => {
  it("fait passer la commande Codex par le flux du broker", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new WindowsHostBrokerClient({
      baseUrl: "http://host.docker.internal:47321",
      token,
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          [
            JSON.stringify({
              type: "stdout",
              data: JSON.stringify({ type: "thread.started", thread_id: "thread_1" }),
            }),
            JSON.stringify({
              type: "stdout",
              data: JSON.stringify({ type: "turn.started" }),
            }),
            JSON.stringify({
              type: "stdout",
              data: JSON.stringify({
                type: "item.completed",
                item: { type: "agent_message", text: "broker output" },
              }),
            }),
            JSON.stringify({
              type: "stdout",
              data: JSON.stringify({
                type: "turn.completed",
                usage: { input_tokens: 1 },
              }),
            }),
            JSON.stringify({ type: "completed", exitCode: 0, status: "succeeded" }),
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          },
        );
      },
    });
    const adapter = new CodexAgentAdapter({
      executablePath: "C:\\Tools\\codex.exe",
      spawn: createBrokerCodexSpawn({
        client,
        executablePath: "C:\\Tools\\codex.exe",
        workspaceRoot: "C:\\CodeRoom\\workspaces",
        workspacePath,
        timeoutMs: request.timeoutMs,
        requestId: () => "broker-request-1",
      }),
    });

    const events = await collect(adapter.execute(request));

    expect(events.at(-1)).toMatchObject({
      type: "result",
      data: { status: "succeeded", executionId: request.executionId },
    });
    expect(body).toMatchObject({
      requestId: "broker-request-1",
      toolId: "codex",
      executablePath: "C:\\Tools\\codex.exe",
      workspaceRoot: "C:\\CodeRoom\\workspaces",
      workspacePath: request.workspacePath,
      argv: [
        "exec",
        "--json",
        "--ephemeral",
        "--sandbox",
        "read-only",
        expect.stringContaining(request.instruction),
      ],
      sessionMode: "isolated",
    });
  });

  it("transmet explicitement le mode de session hôte sans credential", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new WindowsHostBrokerClient({
      baseUrl: "http://host.docker.internal:47321",
      token,
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ type: "completed", exitCode: 0, status: "succeeded" }),
          { status: 200, headers: { "content-type": "application/x-ndjson" } },
        );
      },
    });
    const spawn = createBrokerCodexSpawn({
      client,
      executablePath: "C:\\Tools\\codex.exe",
      workspaceRoot: "C:\\CodeRoom\\workspaces",
      workspacePath,
      sessionMode: "host-login",
      requestId: () => "broker-host-session-1",
    });

    const process = spawn("C:\\Tools\\codex.exe", ["login", "status"], {
      cwd: workspacePath,
      shell: false,
      env: {},
    });
    await new Promise<void>((resolve) => process.on("close", () => resolve()));

    expect(body).toMatchObject({
      requestId: "broker-host-session-1",
      sessionMode: "host-login",
      environment: {},
    });
  });
});
