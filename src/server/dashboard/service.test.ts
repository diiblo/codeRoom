import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { EventService } from "../events/service.js";
import { DashboardService, DashboardServiceError } from "./service.js";

const NOW = "2026-10-22T12:00:00.000Z";
let database: ReturnType<typeof openDatabase>;
let dashboard: DashboardService;

beforeEach(() => {
  database = openDatabase(":memory:");
  dashboard = new DashboardService(database, () => NOW);
});

afterEach(() => database.close());

describe("DashboardService", () => {
  it("valide la portée et libère la transaction après une organisation inconnue", () => {
    expect(() => dashboard.getDashboard(" ")).toThrowError(
      new DashboardServiceError("VALIDATION_ERROR", "organizationId is required"),
    );
    expect(() => dashboard.getDashboard("missing")).toThrowError(
      new DashboardServiceError("NOT_FOUND", "Organization not found"),
    );
    expect(dashboard.getDashboard(" org_local ").organizationId).toBe("org_local");
    expect(dashboard.getDashboard("org_local").projects).toEqual({
      active: 0,
      archived: 0,
    });
  });

  it("compte uniquement les approbations pending strictement avant leur expiration sans mutation", () => {
    const repository = createCoreRepository(database);
    repository.createAgent({ id: "agt_1", displayName: "One", role: "developer" });
    repository.createProject({ id: "prj_1", organizationId: "org_local", name: "One" });
    repository.createAssignment({ id: "asgn_1", projectId: "prj_1", agentId: "agt_1" });
    database
      .prepare(
        `INSERT INTO executions
         (id, project_id, assignment_id, trigger_id, idempotency_key, request_fingerprint, instruction)
       VALUES ('exec_1', 'prj_1', 'asgn_1', 'trigger_1', 'exec_1', '{}', 'Inspect')`,
      )
      .run();
    const expirations = [
      "2026-10-22T11:59:59.999Z",
      NOW,
      "2026-10-22T12:00:00.001Z",
      // Same time as NOW, expressed with an offset rather than Z.
      "2026-10-22T14:00:00.000+02:00",
      "2026-10-22T14:00:00.001+02:00",
    ];
    for (const [index, expiresAt] of expirations.entries()) {
      const id = `approval_${index}`;
      database
        .prepare(
          `INSERT INTO approvals
           (id, action_request_id, project_id, execution_id, assignment_id, action_type,
            required_permission, context_fingerprint, idempotency_key, requested_at, expires_at)
         VALUES (?, ?, 'prj_1', 'exec_1', 'asgn_1', 'git.write', 'git.write_scoped', '{}', ?, ?, ?)`,
        )
        .run(id, id, id, "2026-10-22T11:00:00.000Z", expiresAt);
    }
    const before = database.prepare("SELECT * FROM approvals ORDER BY id").all();
    expect(dashboard.getDashboard("org_local").approvals).toEqual({ pending: 2 });
    expect(database.prepare("SELECT * FROM approvals ORDER BY id").all()).toEqual(
      before,
    );
  });

  it("borne les listes après filtrage, avec un ordre stable même à date égale", () => {
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_other", name: "Other" });
    const events = new EventService(database);
    for (let index = 0; index < 15; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const id = `prj_${suffix}`;
      repository.createProject({ id, organizationId: "org_local", name: id });
      database.prepare("UPDATE projects SET created_at = ? WHERE id = ?").run(NOW, id);
      events.recordEvent({
        id: `evt_${suffix}`,
        type: "ticket.created",
        version: 1,
        projectId: id,
        actor: { type: "human", id: "owner_1" },
        correlationId: id,
        createdAt: NOW,
        payload: { privateData: "must not be exposed" },
      });
    }
    repository.createProject({
      id: "prj_foreign",
      organizationId: "org_other",
      name: "Other",
    });
    events.recordEvent({
      id: "evt_foreign",
      type: "ticket.created",
      version: 1,
      projectId: "prj_foreign",
      actor: { type: "human", id: "owner_1" },
      correlationId: "other",
      createdAt: "2099-01-01T00:00:00.000Z",
    });
    const summary = dashboard.getDashboard("org_local");
    expect(summary.projects).toEqual({ active: 15, archived: 0 });
    expect(summary.recentProjects.map((project) => project.id)).toEqual([
      "prj_14",
      "prj_13",
      "prj_12",
      "prj_11",
      "prj_10",
    ]);
    expect(summary.recentActivity.map((event) => event.id)).toEqual([
      "evt_14",
      "evt_13",
      "evt_12",
      "evt_11",
      "evt_10",
      "evt_09",
      "evt_08",
      "evt_07",
      "evt_06",
      "evt_05",
    ]);
    expect(summary.recentActivity[0]).toEqual({
      id: "evt_14",
      type: "ticket.created",
      projectId: "prj_14",
      createdAt: NOW,
    });
  });
});
