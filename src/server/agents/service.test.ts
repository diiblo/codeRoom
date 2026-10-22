import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { AgentService, AgentServiceError, type ProviderRecord } from "./service.js";

describe("agent and provider services", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: AgentService;

  beforeEach(() => {
    database = openDatabase(":memory:");
    service = new AgentService(database);
  });

  afterEach(() => database.close());

  it("gère le CRUD d'un agent et conserve son profil après archivage", () => {
    service.registerProvider({
      provider: "codex",
      displayName: "Codex",
      status: "available",
      capabilities: { streaming: "supported" },
    });
    const created = service.createAgent({
      id: "agt_1",
      provider: "codex",
      displayName: "Backend Codex",
      role: "developer",
      instructions: "Keep changes small",
      description: "Agent backend",
    });

    expect(created).toMatchObject({
      id: "agt_1",
      provider: "codex",
      role: "developer",
      description: "Agent backend",
      providerState: "available",
      executable: true,
    });
    expect(
      service.createAgent({
        id: "agt_1",
        provider: "codex",
        displayName: "Backend Codex",
        role: "developer",
        instructions: "Keep changes small",
        description: "Agent backend",
      }),
    ).toEqual(created);

    const updated = service.updateAgent({
      agentId: "agt_1",
      role: "reviewer",
      description: null,
    });
    expect(updated).toMatchObject({ role: "reviewer", description: null });

    const archived = service.archiveAgent("agt_1");
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.executable).toBe(false);
    expect(service.archiveAgent("agt_1")).toEqual(archived);
    expect(service.listAgents()).toHaveLength(0);
    expect(service.listAgents({ includeArchived: true })).toMatchObject([
      { id: "agt_1", archivedAt: archived.archivedAt },
    ]);
    expect(() =>
      service.updateAgent({ agentId: "agt_1", displayName: "Changed" }),
    ).toThrowError(
      new AgentServiceError("FORBIDDEN", "Archived agents are not mutable"),
    );
    expect(() => service.assertExecutable("agt_1")).toThrowError(
      new AgentServiceError("FORBIDDEN", "Archived agents cannot execute"),
    );
  });

  it("expose la différence entre fournisseur absent, indisponible et supprimé", () => {
    const missing = service.createAgent({
      id: "agt_1",
      provider: "claude",
      displayName: "Claude",
      role: "developer",
    });
    expect(missing).toMatchObject({
      providerState: "missing",
      executable: false,
    });
    expect(() => service.assertExecutable("agt_1")).toThrowError(
      new AgentServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Provider claude is not executable",
      ),
    );

    service.registerProvider({
      provider: "claude",
      displayName: "Claude",
      status: "unavailable",
    });
    expect(service.getAgent("agt_1")).toMatchObject({
      providerState: "unavailable",
      executable: false,
    });

    service.updateProvider({ provider: "claude", status: "not-installed" });
    expect(service.getAgent("agt_1")).toMatchObject({
      providerState: "not-installed",
      executable: false,
    });

    service.deleteProvider("claude");
    expect(service.getAgent("agt_1")).toMatchObject({
      providerState: "missing",
      executable: false,
    });
    expect(service.listProviders()).toHaveLength(0);
  });

  it("refuse les métadonnées contradictoires et expose les fournisseurs", () => {
    const provider = service.registerProvider({
      provider: "codex",
      displayName: "Codex",
      status: "available",
      capabilities: {
        streaming: "supported",
        nativeResume: "unverified",
      },
    });
    expect(provider).toMatchObject<Partial<ProviderRecord>>({
      provider: "codex",
      status: "available",
      capabilities: {
        streaming: "supported",
        nativeResume: "unverified",
      },
    });
    expect(
      service.registerProvider({
        provider: "codex",
        displayName: "Codex",
        status: "available",
        capabilities: {
          streaming: "supported",
          nativeResume: "unverified",
        },
      }),
    ).toEqual(provider);
    expect(() =>
      service.registerProvider({
        provider: "codex",
        displayName: "Other",
        status: "available",
      }),
    ).toThrowError(
      new AgentServiceError(
        "CONFLICT",
        "Provider is already registered with different metadata",
      ),
    );
    expect(service.listProviders()).toHaveLength(1);
  });

  it("permet de créer un profil sans fournisseur affecté", () => {
    expect(
      service.createAgent({
        id: "agt_1",
        displayName: "Agent",
        role: "developer",
      }),
    ).toMatchObject({ provider: null, providerState: "missing", executable: false });
    expect(() => service.getProvider(" ")).toThrowError(
      new AgentServiceError("VALIDATION_ERROR", "provider must not be empty"),
    );
  });
});
