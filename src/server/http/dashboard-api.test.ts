import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { AgentService } from "../agents/service.js";
import { AssignmentService } from "../assignments/service.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { EventService } from "../events/service.js";
import { EXECUTION_STATES } from "../executions/service.js";
import { TICKET_STATES } from "../tickets/service.js";

const applications: Array<ReturnType<typeof buildApp>> = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];
const humanHeaders = {
  "x-coderoom-actor-id": "owner_1",
  "x-coderoom-actor-type": "human",
};

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  for (const database of databases.splice(0)) database.close();
  vi.restoreAllMocks();
});

async function fixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  for (const id of ["org_1", "org_2", "org_empty"]) {
    repository.createOrganization({ id, name: id });
  }
  const app = buildApp(database);
  applications.push(app);
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  async function get(path: string, headers: Record<string, string> = humanHeaders) {
    const response = await fetch(`${origin}${path}`, { headers });
    return { status: response.status, body: await response.json() };
  }
  return { database, repository, get };
}

describe("Dashboard via HTTP réel", () => {
  it("agrège la DB par organisation, distingue les états et protège l’activité", async () => {
    const { database, repository, get } = await fixture();
    const agents = new AgentService(database);
    for (const id of ["agt_shared", "agt_unused", "agt_archived"]) {
      agents.createAgent({ id, displayName: id, role: "developer" });
    }
    agents.archiveAgent("agt_archived");
    for (const [id, organizationId] of [
      ["prj_active", "org_1"],
      ["prj_archived", "org_1"],
      ["prj_foreign", "org_2"],
    ]) {
      repository.createProject({ id, organizationId, name: id });
    }
    const assignments = new AssignmentService(database);
    for (const [id, projectId, agentId] of [
      ["asgn_active", "prj_active", "agt_shared"],
      ["asgn_archived", "prj_active", "agt_unused"],
      ["asgn_history", "prj_archived", "agt_shared"],
      ["asgn_foreign", "prj_foreign", "agt_shared"],
    ]) {
      assignments.createAssignment({
        id,
        projectId,
        agentId,
        permissionSet: [],
        idempotencyKey: id,
      });
    }
    assignments.archiveAssignment("asgn_archived");
    database
      .prepare("UPDATE projects SET status = 'archived' WHERE id = ?")
      .run("prj_archived");
    database
      .prepare("UPDATE projects SET created_at = ? WHERE id = ?")
      .run("2026-01-01T00:00:00.000Z", "prj_active");
    database
      .prepare("UPDATE projects SET created_at = ? WHERE id = ?")
      .run("2026-01-02T00:00:00.000Z", "prj_archived");

    for (const state of TICKET_STATES) {
      database
        .prepare(
          `INSERT INTO tickets (id, project_id, title, body, author_type, author_id, state)
         VALUES (?, 'prj_active', 'Ticket', 'Private body', 'human', 'owner_1', ?)`,
        )
        .run(`tkt_${state}`, state);
    }
    for (const [id, projectId, state] of [
      ["tkt_history", "prj_archived", "done"],
      ["tkt_foreign", "prj_foreign", "todo"],
    ]) {
      database
        .prepare(
          `INSERT INTO tickets (id, project_id, title, body, author_type, author_id, state)
         VALUES (?, ?, 'Ticket', 'Private body', 'human', 'owner_1', ?)`,
        )
        .run(id, projectId, state);
    }

    for (const state of EXECUTION_STATES) {
      // Each active execution uses a distinct assignment; historical states remain readable.
      const projectId = state === "running" ? "prj_archived" : "prj_active";
      let assignmentId = state === "running" ? "asgn_history" : "asgn_active";
      if (state === "awaiting_approval") {
        repository.createAssignment({
          id: "asgn_approval",
          projectId,
          agentId: "agt_unused",
        });
        assignmentId = "asgn_approval";
      }
      database
        .prepare(
          `INSERT INTO executions
           (id, project_id, assignment_id, trigger_id, idempotency_key, request_fingerprint, instruction, state)
         VALUES (?, ?, ?, ?, ?, '{}', 'Private instruction', ?)`,
        )
        .run(`exec_${state}`, projectId, assignmentId, state, state, state);
    }
    database
      .prepare(
        `INSERT INTO executions
         (id, project_id, assignment_id, trigger_id, idempotency_key, request_fingerprint, instruction)
       VALUES ('exec_foreign', 'prj_foreign', 'asgn_foreign', 'foreign', 'foreign', '{}', 'Private')`,
      )
      .run();
    for (const [id, projectId, executionId, assignmentId, status, expiresAt] of [
      [
        "approval_pending",
        "prj_active",
        "exec_awaiting_approval",
        "asgn_approval",
        "pending",
        "2099-01-01T00:00:00.000Z",
      ],
      [
        "approval_past",
        "prj_active",
        "exec_awaiting_approval",
        "asgn_approval",
        "pending",
        "2000-01-01T00:00:00.000Z",
      ],
      [
        "approval_approved",
        "prj_active",
        "exec_awaiting_approval",
        "asgn_approval",
        "approved",
        "2099-01-01T00:00:00.000Z",
      ],
      [
        "approval_denied",
        "prj_active",
        "exec_awaiting_approval",
        "asgn_approval",
        "denied",
        "2099-01-01T00:00:00.000Z",
      ],
      [
        "approval_expired",
        "prj_active",
        "exec_awaiting_approval",
        "asgn_approval",
        "expired",
        "2099-01-01T00:00:00.000Z",
      ],
      [
        "approval_foreign",
        "prj_foreign",
        "exec_foreign",
        "asgn_foreign",
        "pending",
        "2099-01-01T00:00:00.000Z",
      ],
    ]) {
      database
        .prepare(
          `INSERT INTO approvals
           (id, action_request_id, project_id, execution_id, assignment_id, action_type,
            required_permission, context_fingerprint, idempotency_key, status, requested_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'git.write', 'git.write_scoped', '{}', ?, ?, '2026-01-01T00:00:00.000Z', ?)`,
        )
        .run(id, id, projectId, executionId, assignmentId, id, status, expiresAt);
    }
    const events = new EventService(database);
    for (const [id, projectId, createdAt] of [
      ["evt_active", "prj_active", "2026-01-02T00:00:00.000Z"],
      ["evt_history", "prj_archived", "2026-01-01T00:00:00.000Z"],
      ["evt_foreign", "prj_foreign", "2099-01-01T00:00:00.000Z"],
      ["evt_global", null, "2099-01-01T00:00:00.000Z"],
    ]) {
      events.recordEvent({
        id: id as string,
        projectId,
        type: "ticket.created",
        version: 1,
        actor: { type: "human", id: "owner_1" },
        correlationId: id as string,
        createdAt: createdAt as string,
        payload: { content: "Private activity", brokerToken: "secret" },
      });
    }

    const response = await get("/api/dashboard?organizationId=org_1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      organizationId: "org_1",
      projects: { active: 1, archived: 1 },
      agents: { active: 2, archived: 1 },
      assignments: { active: 2 },
      tickets: {
        todo: 1,
        in_progress: 1,
        in_review: 1,
        done: 2,
        blocked: 1,
        cancelled: 1,
      },
      executions: {
        queued: 1,
        running: 1,
        awaiting_approval: 1,
        succeeded: 1,
        failed: 1,
        cancelled: 1,
        unknown: 1,
      },
      approvals: { pending: 1 },
      recentProjects: [
        {
          id: "prj_archived",
          name: "prj_archived",
          status: "archived",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "prj_active",
          name: "prj_active",
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      recentActivity: [
        {
          id: "evt_active",
          type: "ticket.created",
          projectId: "prj_active",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
        {
          id: "evt_history",
          type: "ticket.created",
          projectId: "prj_archived",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /foreign|Private|secret|payload|brokerToken/,
    );
    const foreign = await get("/api/dashboard?organizationId=org_2");
    expect(foreign.body.projects).toEqual({ active: 1, archived: 0 });
    expect(foreign.body.agents).toEqual(response.body.agents);
    expect(foreign.body.assignments).toEqual({ active: 1 });
    expect(foreign.body.tickets.todo).toBe(1);
    expect(foreign.body.executions.queued).toBe(1);
    expect(foreign.body.approvals.pending).toBe(1);
    expect(
      foreign.body.recentActivity.map((event: { id: string }) => event.id),
    ).toEqual(["evt_foreign"]);
    const empty = await get("/api/dashboard?organizationId=org_empty");
    expect(empty.body.agents).toEqual(response.body.agents);
    expect(empty.body.projects).toEqual({ active: 0, archived: 0 });
    expect(empty.body.assignments.active).toBe(0);
    expect(Object.values(empty.body.tickets)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(Object.values(empty.body.executions)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(empty.body.approvals.pending).toBe(0);
    expect(empty.body.recentProjects).toEqual([]);
    expect(empty.body.recentActivity).toEqual([]);
  });

  it("renvoie un contrat complet à zéro sur une base sans données métier", async () => {
    const { get } = await fixture();
    const response = await get("/api/dashboard?organizationId=org_empty");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      organizationId: "org_empty",
      projects: { active: 0, archived: 0 },
      agents: { active: 0, archived: 0 },
      assignments: { active: 0 },
      tickets: {
        todo: 0,
        in_progress: 0,
        in_review: 0,
        done: 0,
        blocked: 0,
        cancelled: 0,
      },
      executions: {
        queued: 0,
        running: 0,
        awaiting_approval: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
        unknown: 0,
      },
      approvals: { pending: 0 },
      recentProjects: [],
      recentActivity: [],
    });
  });

  it.each([
    [{}, 401],
    [{ "x-coderoom-actor-type": "human" }, 401],
    [{ "x-coderoom-actor-id": "agent_1" }, 403],
    [{ "x-coderoom-actor-id": "system_1", "x-coderoom-actor-type": "system" }, 403],
  ])("réserve l’agrégat à une identité humaine : %j", async (headers, status) => {
    const { database, get } = await fixture();
    const prepare = vi.spyOn(database, "prepare");
    const response = await get(
      "/api/dashboard?organizationId=org_1",
      headers as Record<string, string>,
    );
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(
      status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it.each([
    ["/api/dashboard", 422, "VALIDATION_ERROR"],
    ["/api/dashboard?organizationId=", 422, "VALIDATION_ERROR"],
    ["/api/dashboard?organizationId=%20", 422, "VALIDATION_ERROR"],
    [
      "/api/dashboard?organizationId=org_1&organizationId=org_2",
      422,
      "VALIDATION_ERROR",
    ],
    ["/api/dashboard?organizationId=missing", 404, "NOT_FOUND"],
    ["/api/dashboard?organizationId=org_1%27%20OR%201%3D1--", 404, "NOT_FOUND"],
  ])(
    "valide l’organisation sans élargir la portée : %s",
    async (path, status, code) => {
      const { get } = await fixture();
      const response = await get(path as string);
      expect(response.status).toBe(status);
      expect(response.body.error.code).toBe(code);
    },
  );

  it("masque une erreur de lecture et conserve la corrélation HTTP", async () => {
    const { database, get } = await fixture();
    vi.spyOn(database, "prepare").mockImplementationOnce(() => {
      throw new Error("Private database path and credentials");
    });
    const response = await get("/api/dashboard?organizationId=org_1", {
      ...humanHeaders,
      "x-correlation-id": "corr_dashboard",
    });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        correlationId: "corr_dashboard",
      },
    });
    expect((await get("/api/dashboard?organizationId=org_1")).status).toBe(200);
  });
});
