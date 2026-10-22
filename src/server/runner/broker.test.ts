import { describe, expect, it } from "vitest";
import { HostBrokerError, WindowsHostBrokerClient } from "./broker.js";

const token = "broker-test-token-012345678901234567890123";
const baseUrl = "http://host.docker.internal:47321";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("WindowsHostBrokerClient", () => {
  it("interroge la découverte avec un token et valide le profil Windows", async () => {
    let captured: RequestInit | undefined;
    const client = new WindowsHostBrokerClient({
      baseUrl,
      token,
      fetchImpl: async (_input, init) => {
        captured = init;
        return response({
          version: "windows-discovery-v1",
          platform: "windows",
          architecture: "x64",
          tools: [
            {
              id: "antigravity",
              executablePath: "C:\\Users\\TestUser\\AppData\\Local\\agy\\bin\\agy.exe",
              source: "explicit",
            },
          ],
          missing: ["codex"],
          execution: "discovery-only",
          requestId: "request-1",
        });
      },
    });

    const result = await client.discover({
      antigravityPath: "C:\\custom\\agy.exe",
      opencodePath: "C:\\custom\\opencode.exe",
    });

    expect(result.missing).toEqual(["codex"]);
    expect(captured?.method).toBe("POST");
    expect(captured?.headers).toMatchObject({ Authorization: `Bearer ${token}` });
    expect(captured?.body).toBe(
      JSON.stringify({
        antigravityPath: "C:\\custom\\agy.exe",
        opencodePath: "C:\\custom\\opencode.exe",
      }),
    );
  });

  it("valide un plan sans autoriser l'exécution", async () => {
    const client = new WindowsHostBrokerClient({
      baseUrl,
      token,
      fetchImpl: async () =>
        response({
          version: "coderoom-broker-plan-v1",
          requestId: "request-2",
          platform: "windows",
          architecture: "x64",
          toolId: "antigravity",
          executablePath: "C:\\Users\\TestUser\\AppData\\Local\\agy\\bin\\agy.exe",
          cwd: "C:\\CodeRoom\\workspaces\\project-1",
          argv: ["--headless"],
          environmentKeys: ["CODE_ROOM_PROJECT_ID"],
          secretKeys: [],
          timeoutMs: 30_000,
          shell: false,
          killProcessTree: true,
          allowedNetworkHosts: [],
          execution: "disabled-until-windows-proof",
        }),
    });

    const plan = await client.plan({
      toolId: "antigravity",
      executablePath: "C:\\Users\\TestUser\\AppData\\Local\\agy\\bin\\agy.exe",
      workspaceRoot: "C:\\CodeRoom\\workspaces\\project-1",
      workspacePath: "C:\\CodeRoom\\workspaces\\project-1\\execution-1",
      argv: ["--headless"],
      environment: { CODE_ROOM_PROJECT_ID: "project-1" },
      timeoutMs: 30_000,
    });

    expect(plan.execution).toBe("disabled-until-windows-proof");
    expect(plan.shell).toBe(false);
  });

  it("accepte un plan activé après validation de la gate Windows", async () => {
    const client = new WindowsHostBrokerClient({
      baseUrl,
      token,
      fetchImpl: async () =>
        response({
          version: "coderoom-broker-plan-v1",
          requestId: "request-3",
          platform: "windows",
          architecture: "x64",
          toolId: "codex",
          executablePath: "C:\\Tools\\codex.exe",
          cwd: "C:\\CodeRoom\\workspaces\\project-1",
          argv: ["--version"],
          environmentKeys: [],
          secretKeys: [],
          timeoutMs: 10_000,
          shell: false,
          killProcessTree: true,
          allowedNetworkHosts: [],
          execution: "enabled",
        }),
    });

    const plan = await client.plan({
      toolId: "codex",
      executablePath: "C:\\Tools\\codex.exe",
      workspaceRoot: "C:\\CodeRoom\\workspaces",
      workspacePath: "C:\\CodeRoom\\workspaces\\project-1",
      argv: ["--version"],
      environment: {},
      timeoutMs: 10_000,
    });

    expect(plan.execution).toBe("enabled");
  });

  it("refuse une URL de broker non locale", () => {
    expect(
      () => new WindowsHostBrokerClient({ baseUrl: "http://evil.example", token }),
    ).toThrow(HostBrokerError);
  });

  it("transforme un refus distant en erreur contrôlée", async () => {
    const client = new WindowsHostBrokerClient({
      baseUrl,
      token,
      fetchImpl: async () =>
        response({ error: "execution-disabled-until-windows-proof" }, 409),
    });

    await expect(client.discover()).rejects.toMatchObject({
      code: "REMOTE_REJECTED",
    });
  });

  it("valide un flux d'exécution NDJSON borné", async () => {
    const client = new WindowsHostBrokerClient({
      baseUrl,
      token,
      fetchImpl: async () =>
        new Response(
          [
            JSON.stringify({ type: "stdout", data: '{"type":"thread.started"}' }),
            JSON.stringify({ type: "stderr", data: "diagnostic\n" }),
            JSON.stringify({
              type: "completed",
              exitCode: 0,
              status: "succeeded",
            }),
          ].join("\n"),
          {
            status: 200,
            headers: { "content-type": "application/x-ndjson" },
          },
        ),
    });

    const execution = client.execute({
      toolId: "codex",
      executablePath: "C:\\Tools\\codex.exe",
      workspaceRoot: "C:\\CodeRoom\\workspaces",
      workspacePath: "C:\\CodeRoom\\workspaces\\project-1",
      argv: ["exec", "--json"],
      environment: {},
      timeoutMs: 30_000,
    });
    const frames = [];
    for await (const frame of execution.frames) frames.push(frame);

    expect(frames).toEqual([
      { type: "stdout", data: '{"type":"thread.started"}' },
      { type: "stderr", data: "diagnostic\n" },
      { type: "completed", exitCode: 0, signal: undefined, status: "succeeded" },
    ]);
  });
});
