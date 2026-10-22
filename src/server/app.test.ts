import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type { HostBrokerDiscoveryClient } from "./runner/broker.js";

describe("CodeRoom API", () => {
  const apps = [] as Array<ReturnType<typeof buildApp>>;

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("expose un health check", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("autorise le preflight PATCH depuis l’interface locale uniquement", async () => {
    const app = buildApp();
    apps.push(app);
    const headers = {
      origin: "http://127.0.0.1:5173",
      "access-control-request-method": "PATCH",
      "access-control-request-headers": "content-type,x-coderoom-actor-id",
    };
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/projects/project_1",
      headers,
    });
    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(headers.origin);
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
    const foreign = await app.inject({
      method: "OPTIONS",
      url: "/api/agents/agent_1",
      headers: { ...headers, origin: "https://example.com" },
    });
    expect(foreign.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("indique que l'exécution réelle reste désactivée", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "skeleton",
      execution: "disabled",
      configuredTools: [],
    });
  });

  it("expose la découverte des outils hôte sans leurs chemins", async () => {
    const hostBroker: HostBrokerDiscoveryClient = {
      discover: async () => ({
        version: "windows-discovery-v1",
        platform: "windows",
        architecture: "x64",
        tools: [
          {
            id: "antigravity",
            executablePath: "C:\\Users\\TestUser\\AppData\\Local\\agy\\bin\\agy.exe",
            source: "known-path",
          },
        ],
        missing: ["codex"],
        execution: "discovery-only",
        requestId: "status-request",
      }),
    };
    const app = buildApp(undefined, { hostBroker });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/status" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      hostTools: {
        state: "connected",
        tools: [{ id: "antigravity", source: "known-path" }],
        missing: ["codex"],
      },
    });
    expect(response.body).not.toContain("TestUser");
  });
});
