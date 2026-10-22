import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { AgentService } from "../agents/service.js";
import { AssignmentService } from "../assignments/service.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ProjectService } from "../projects/service.js";
import { TicketService } from "../tickets/service.js";

const applications: Array<ReturnType<typeof buildApp>> = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];
const humanHeaders = {
  "x-coderoom-actor-id": "owner_1",
  "x-coderoom-actor-type": "human",
};
const profile = {
  id: "agt_profile",
  displayName: "Profile",
  role: "developer",
  instructions: "Small changes",
  description: "Backend",
};

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
});

async function fixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const app = buildApp(database);
  applications.push(app);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  async function request(
    method: string,
    path: string,
    payload?: unknown,
    headers: Record<string, string> = humanHeaders,
  ) {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...headers,
        ...(payload === undefined ? {} : { "content-type": "application/json" }),
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }
  return { database, request, agents: new AgentService(database) };
}

describe("Profils via HTTP réel", () => {
  it("crée sans projet, rejoue, modifie les quatre champs et relit le profil", async () => {
    const { request } = await fixture();
    const created = await request("POST", "/api/agents", profile);
    expect(created.status).toBe(201);
    expect(created.body.agent).toMatchObject({
      ...profile,
      provider: null,
      archivedAt: null,
      executable: false,
    });
    expect(await request("POST", "/api/agents", profile)).toEqual(created);
    expect(
      (await request("POST", "/api/agents", { ...profile, role: "other" })).status,
    ).toBe(409);

    const changes = {
      displayName: " Updated ",
      role: " reviewer ",
      instructions: " Review carefully ",
      description: " New description ",
    };
    const updated = await request("PATCH", `/api/agents/${profile.id}`, changes);
    expect(updated.status).toBe(200);
    expect(updated.body.agent).toEqual({
      ...created.body.agent,
      displayName: "Updated",
      role: "reviewer",
      instructions: "Review carefully",
      description: "New description",
    });
    expect(await request("PATCH", `/api/agents/${profile.id}`, changes)).toEqual(
      updated,
    );

    const cleared = await request("PATCH", `/api/agents/${profile.id}`, {
      instructions: "",
      description: null,
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.agent).toEqual({
      ...updated.body.agent,
      instructions: "",
      description: null,
    });
    expect(await request("PATCH", `/api/agents/${profile.id}`, {})).toEqual(cleared);
    const reread = await request("GET", "/api/agents");
    expect(reread.status).toBe(200);
    expect(reread.body.items).toEqual([cleared.body.agent]);
  });

  it.each([
    { provider: "other" },
    { provider: null },
    { id: "other" },
    { archivedAt: "2026-01-01T00:00:00.000Z" },
    { permissionSet: ["git.write_scoped"] },
    { actorId: "other" },
    { executable: true },
    { providerState: "available" },
  ])("refuse un champ interdit sans mutation partielle : %j", async (extra) => {
    const { request, agents } = await fixture();
    const original = agents.createAgent({ ...profile, provider: "legacy" });
    const response = await request("PATCH", `/api/agents/${profile.id}`, {
      displayName: "Must not persist",
      ...extra,
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(agents.getAgent(profile.id)).toEqual(original);
  });

  it.each([
    null,
    [],
    { displayName: " " },
    { role: "" },
    { role: null },
    { displayName: 42 },
    { instructions: null },
    { instructions: [] },
    { description: false },
  ])("valide les types et les champs obligatoires : %j", async (payload) => {
    const { request, agents } = await fixture();
    const original = agents.createAgent(profile);
    const response = await request("PATCH", `/api/agents/${profile.id}`, payload);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(agents.getAgent(profile.id)).toEqual(original);
  });

  it("conserve le fournisseur legacy pendant une modification autorisée", async () => {
    const { request, agents } = await fixture();
    const original = agents.createAgent({ ...profile, provider: "legacy" });
    const updated = await request("PATCH", `/api/agents/${profile.id}`, {
      role: "administrator",
      description: " ",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.agent).toEqual({
      ...original,
      role: "administrator",
      description: null,
    });
  });

  it("archive de façon idempotente, préserve l’historique et bloque les nouveaux usages", async () => {
    const { database, request, agents } = await fixture();
    expect((await request("POST", "/api/agents", profile)).status).toBe(201);
    agents.createAgent({ id: "agt_reader", displayName: "Reader", role: "reader" });
    createCoreRepository(database).createOrganization({ id: "org_1", name: "One" });
    const projects = new ProjectService(database);
    for (const id of ["prj_1", "prj_2"]) {
      projects.createProject({
        id,
        organizationId: "org_1",
        name: id,
        mainConversationId: `conv_${id}`,
        idempotencyKey: id,
      });
    }
    const assignments = new AssignmentService(database);
    for (const agentId of [profile.id, "agt_reader"]) {
      assignments.createAssignment({
        id: `asgn_${agentId}`,
        projectId: "prj_1",
        agentId,
        provider: "codex",
        permissionSet: ["message.read", "message.send"],
        idempotencyKey: agentId,
      });
    }
    const assignmentBefore = assignments.getAssignment(`asgn_${profile.id}`);
    const authorHeaders = {
      "x-coderoom-actor-id": profile.id,
      "x-coderoom-assignment-id": `asgn_${profile.id}`,
    };
    expect(
      (
        await request(
          "POST",
          "/api/conversations/conv_prj_1/messages",
          { id: "msg_history", text: "Persisted history" },
          { ...authorHeaders, "idempotency-key": "msg_history" },
        )
      ).status,
    ).toBe(201);
    const ticket = new TicketService(database).createTicket({
      id: "tkt_history",
      projectId: "prj_1",
      title: "History",
      body: "Keep author and owner",
      author: { type: "agent", id: profile.id },
      ownerId: profile.id,
      acceptanceCriteria: ["Preserved"],
      idempotencyKey: "tkt_history",
    });

    const archived = await request("POST", `/api/agents/${profile.id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.agent.archivedAt).toEqual(expect.any(String));
    expect(archived.body.agent.executable).toBe(false);
    expect(await request("POST", `/api/agents/${profile.id}/archive`, {})).toEqual(
      archived,
    );
    const active = await request("GET", "/api/agents");
    expect(active.body.items.map((agent: { id: string }) => agent.id)).toEqual([
      "agt_reader",
    ]);
    const history = await request("GET", "/api/agents?includeArchived=true");
    expect(history.status).toBe(200);
    expect(history.body.items).toContainEqual(archived.body.agent);
    expect(
      (await request("PATCH", `/api/agents/${profile.id}`, { role: "other" })).status,
    ).toBe(403);
    expect(
      (
        await request(
          "POST",
          "/api/projects/prj_2/assignments",
          { id: "asgn_new", agentId: profile.id, provider: "codex", permissionSet: [] },
          { ...humanHeaders, "idempotency-key": "asgn_new" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          "POST",
          "/api/conversations/conv_prj_1/messages",
          { id: "msg_after", text: "Must fail" },
          { ...authorHeaders, "idempotency-key": "msg_after" },
        )
      ).status,
    ).toBe(403);
    expect(assignments.getAssignment(`asgn_${profile.id}`)).toEqual(assignmentBefore);
    const messages = await request(
      "GET",
      "/api/conversations/conv_prj_1/messages",
      undefined,
      {
        "x-coderoom-actor-id": "agt_reader",
        "x-coderoom-assignment-id": "asgn_agt_reader",
      },
    );
    expect(messages.status).toBe(200);
    expect(messages.body.items).toMatchObject([
      { id: "msg_history", authorId: profile.id, text: "Persisted history" },
    ]);
    const rereadTicket = await request("GET", `/api/tickets/${ticket.id}`);
    expect(rereadTicket.status).toBe(200);
    expect(rereadTicket.body.ticket).toEqual(ticket);
    expect(agents.getAgent(profile.id)).toEqual(archived.body.agent);
  });

  it.each(["PATCH", "POST"])(
    "renvoie 404 pour un profil absent (%s)",
    async (method) => {
      const { request } = await fixture();
      const response = await request(
        method,
        `/api/agents/missing${method === "POST" ? "/archive" : ""}`,
        method === "PATCH" ? { role: "reviewer" } : undefined,
      );
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("NOT_FOUND");
    },
  );

  it.each([
    ["GET", "/api/agents", undefined],
    ["POST", "/api/agents", profile],
    ["PATCH", `/api/agents/${profile.id}`, { role: "other" }],
    ["POST", `/api/agents/${profile.id}/archive`, undefined],
  ])("exige une identité avant %s %s", async (method, path, payload) => {
    const { request, agents } = await fixture();
    const original = agents.createAgent(profile);
    const response = await request(method as string, path as string, payload, {});
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
    expect(agents.getAgent(profile.id)).toEqual(original);
  });
});
