import type { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "../agents/service.js";
import { AssignmentService } from "../assignments/service.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository, transaction } from "../db/repository.js";
import { EventService, eventCursor } from "../events/service.js";
import { ProjectService } from "../projects/service.js";
import { buildApp } from "../app.js";

const applications: Array<ReturnType<typeof buildApp>> = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
});

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  const agents = new AgentService(database);
  agents.createAgent({
    id: "agt_1",
    provider: "codex",
    displayName: "One",
    role: "developer",
  });
  agents.createAgent({
    id: "agt_2",
    provider: "claude",
    displayName: "Two",
    role: "reviewer",
  });
  const projects = new ProjectService(database);
  projects.createProject({
    id: "prj_1",
    organizationId: "org_1",
    name: "One",
    idempotencyKey: "project_req_1",
  });
  projects.createProject({
    id: "prj_2",
    organizationId: "org_1",
    name: "Two",
    idempotencyKey: "project_req_2",
  });
  const assignments = new AssignmentService(database);
  assignments.createAssignment({
    id: "asgn_1",
    projectId: "prj_1",
    agentId: "agt_1",
    permissionSet: ["project.read"],
    idempotencyKey: "assignment_req_1",
  });
  assignments.createAssignment({
    id: "asgn_2",
    projectId: "prj_2",
    agentId: "agt_2",
    permissionSet: ["project.read"],
    idempotencyKey: "assignment_req_2",
  });
  return database;
}

function identityHeaders() {
  return {
    "x-coderoom-actor-id": "agt_1",
    "x-coderoom-assignment-id": "asgn_1",
  };
}

function appendEvent(
  database: ReturnType<typeof openDatabase>,
  id: string,
  projectId: string,
  createdAt: string,
) {
  const service = new EventService(database);
  return transaction(database, () =>
    service.recordEvent({
      id,
      type: "message.posted",
      version: 1,
      projectId,
      actor: { type: "agent", id: "agt_1" },
      correlationId: id,
      createdAt,
      payload: { messageId: id },
    }),
  );
}

function messageCapture() {
  const messages: Array<Record<string, unknown>> = [];
  const waiters: Array<{
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  const onMessage = (raw: Buffer) => {
    const message = JSON.parse(raw.toString()) as Record<string, unknown>;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(message);
    }
  };

  return {
    messages,
    options: {
      onInit: (socket: WebSocket) => socket.on("message", onMessage),
    },
    waitFor(predicate: (message: Record<string, unknown>) => boolean, timeout = 3_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiters.findIndex((waiter) => waiter.timer === timer);
          if (index >= 0) waiters.splice(index, 1);
          reject(new Error("Timed out waiting for WebSocket message"));
        }, timeout);
        waiters.push({ predicate, resolve, reject, timer });
      });
    },
  };
}

async function closeSocket(socket: WebSocket) {
  if (socket.readyState === socket.CLOSED) return;
  await new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close();
  });
}

describe("WebSocket événements", () => {
  it("rejoue après curseur et reprend sans trou après reconnexion", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);
    await app.ready();
    const first = appendEvent(database, "evt_1", "prj_1", "2026-01-01T00:00:00.001Z");
    const second = appendEvent(database, "evt_2", "prj_1", "2026-01-01T00:00:00.002Z");
    const firstCapture = messageCapture();
    const firstSocket = await app.injectWS(
      `/api/events?projectId=prj_1&cursor=${eventCursor(first)}`,
      { headers: identityHeaders() },
      firstCapture.options,
    );

    await firstCapture.waitFor((message) => message.id === second.id);
    expect(firstCapture.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ready", projectId: "prj_1" }),
        expect.objectContaining({ id: "evt_2", projectId: "prj_1" }),
      ]),
    );
    expect(firstCapture.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "evt_1" })]),
    );
    await closeSocket(firstSocket);

    const third = appendEvent(database, "evt_3", "prj_1", "2026-01-01T00:00:00.003Z");
    const secondCapture = messageCapture();
    const secondSocket = await app.injectWS(
      `/api/events?projectId=prj_1&cursor=${eventCursor(second)}`,
      { headers: identityHeaders() },
      secondCapture.options,
    );
    await secondCapture.waitFor((message) => message.id === third.id);
    expect(secondCapture.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "evt_1" })]),
    );
    expect(secondCapture.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "evt_2" })]),
    );
    await closeSocket(secondSocket);
  });

  it("ne diffuse pas les événements d'un projet tiers", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);
    await app.ready();
    appendEvent(database, "evt_other_project", "prj_2", "2026-01-01T00:00:00.001Z");
    const capture = messageCapture();
    const socket = await app.injectWS(
      "/api/events?projectId=prj_1",
      { headers: identityHeaders() },
      capture.options,
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(capture.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "evt_other_project" })]),
    );
    await closeSocket(socket);
  });

  it("refuse l'abonnement sans identité autorisée", async () => {
    const database = createFixture();
    const app = buildApp(database);
    applications.push(app);
    await app.ready();

    await expect(app.injectWS("/api/events?projectId=prj_1")).rejects.toThrow();
    await expect(
      app.injectWS("/api/events?projectId=prj_2", {
        headers: identityHeaders(),
      }),
    ).rejects.toThrow();
  });
});
