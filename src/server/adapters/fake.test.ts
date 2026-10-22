import { describe, expect, it } from "vitest";
import type { ProviderEvent, ValidatedExecutionRequest } from "./contract.js";
import { FakeAdapterError, FakeAgentAdapter } from "./fake.js";

const request: ValidatedExecutionRequest = {
  executionId: "exec_1",
  projectId: "prj_1",
  assignmentId: "asgn_1",
  triggerId: "trigger_1",
  instruction: "Inspect the repository",
  contextRefs: [],
};

async function collect(stream: AsyncIterable<ProviderEvent>) {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("FakeAgentAdapter", () => {
  it("expose les capacités avec un statut explicite", async () => {
    const adapter = new FakeAgentAdapter({
      capabilities: { streaming: "supported" },
    });

    await expect(adapter.probe()).resolves.toEqual({
      provider: "fake",
      executableVersion: "fake-1.0.0",
      installed: true,
      authStatus: "ready",
      capabilities: {
        streaming: "supported",
        nativeResume: "unverified",
        nativeApproval: "unverified",
        structuredActions: "unverified",
      },
    });
  });

  it("produit des messages, événements et un résultat de succès", async () => {
    const adapter = new FakeAgentAdapter({
      steps: [
        { kind: "message", content: "started" },
        { kind: "pause", durationMs: 1 },
        { kind: "event", type: "tool_activity", data: { tool: "search" } },
      ],
    });

    const events = await collect(adapter.execute(request));

    expect(events.map((event) => event.type)).toEqual([
      "output",
      "tool_activity",
      "result",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events[0]).toMatchObject({ data: { content: "started" } });
    expect(events.at(-1)).toMatchObject({
      type: "result",
      data: { status: "succeeded", executionId: "exec_1" },
    });
  });

  it("refuse une sortie malformée sans la convertir en succès", async () => {
    const adapter = new FakeAgentAdapter({
      steps: [{ kind: "raw", value: { type: "output", content: "wrong shape" } }],
    });

    await expect(collect(adapter.execute(request))).rejects.toMatchObject({
      code: "OUTPUT_MALFORMED",
    });
  });

  it("interrompt une exécution en pause et rend l'annulation observable", async () => {
    const adapter = new FakeAgentAdapter({
      steps: [
        { kind: "pause", durationMs: 1_000 },
        { kind: "message", content: "must not be emitted" },
      ],
    });
    const stream = adapter.execute(request);
    const iterator = stream[Symbol.asyncIterator]();
    const firstEvent = iterator.next();

    await expect(adapter.cancel("exec_1")).resolves.toEqual({
      executionHandle: "exec_1",
      status: "cancelled",
    });
    await expect(firstEvent).resolves.toMatchObject({
      value: { type: "error", data: { code: "CANCELLED" } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "result", data: { status: "cancelled" } },
    });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
    await expect(adapter.cancel("exec_1")).resolves.toEqual({
      executionHandle: "exec_1",
      status: "already-finished",
    });
  });

  it("rend un timeout visible et arrête le flux", async () => {
    const adapter = new FakeAgentAdapter({
      steps: [{ kind: "pause", durationMs: 50 }],
    });

    await expect(
      collect(adapter.execute({ ...request, timeoutMs: 5 })),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
    } satisfies Partial<FakeAdapterError>);
  });
});
