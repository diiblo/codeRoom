import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import {
  ExecutionService,
  ExecutionServiceError,
  type EnqueueExecutionInput,
} from "./service.js";

const databases: Array<ReturnType<typeof openDatabase>> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  repository.createAgent({
    id: "agt_1",
    provider: "fake",
    displayName: "Fake",
    role: "developer",
  });
  repository.createAgent({
    id: "agt_2",
    provider: "fake",
    displayName: "Second",
    role: "reviewer",
  });
  repository.createProject({ id: "prj_1", organizationId: "org_1", name: "One" });
  repository.createProject({ id: "prj_2", organizationId: "org_1", name: "Two" });
  repository.createAssignment({
    id: "asgn_1",
    projectId: "prj_1",
    agentId: "agt_1",
    permissionSet: ["project.read"],
  });
  repository.createAssignment({
    id: "asgn_2",
    projectId: "prj_2",
    agentId: "agt_2",
    permissionSet: ["project.read"],
  });
  return database;
}

function request(
  overrides: Partial<EnqueueExecutionInput> = {},
): EnqueueExecutionInput {
  return {
    id: "exec_1",
    projectId: "prj_1",
    assignmentId: "asgn_1",
    triggerId: "trigger_1",
    instruction: "Inspect the repository",
    contextRefs: ["project:prj_1"],
    idempotencyKey: "exec_req_1",
    ...overrides,
  };
}

describe("ExecutionService", () => {
  it("déduplique un dispatch et refuse une mutation sous la même clé", () => {
    const database = createFixture();
    const service = new ExecutionService(database, {
      now: () => "2026-01-01T00:00:00.000Z",
    });

    const first = service.enqueue(request());
    const repeated = service.enqueue(request());

    expect(repeated).toEqual(first);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM executions").get(),
    ).toMatchObject({ count: 1 });
    expect(service.listTransitions(first.id)).toHaveLength(1);

    expect(() =>
      service.enqueue(request({ instruction: "Different request" })),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutionServiceError>>({ code: "CONFLICT" }),
    );
    expect(() =>
      service.enqueue(
        request({
          id: "exec_2",
          triggerId: "trigger_2",
          idempotencyKey: "exec_req_2",
        }),
      ),
    ).toThrowError("Assignment already has an active execution");
  });

  it("ne réserve qu'une fois une file partagée entre deux workers", async () => {
    const database = createFixture();
    const firstService = new ExecutionService(database, { leaseDurationMs: 1_000 });
    const secondService = new ExecutionService(database, { leaseDurationMs: 1_000 });
    firstService.enqueue(request());

    const [first, second] = await Promise.all([
      Promise.resolve(firstService.reserveNext("worker_1", "2026-01-01T00:00:00.000Z")),
      Promise.resolve(
        secondService.reserveNext("worker_2", "2026-01-01T00:00:00.000Z"),
      ),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(first ?? second).toMatchObject({
      id: "exec_1",
      state: "running",
      leaseOwner: expect.stringMatching(/^worker_[12]$/),
    });
    expect(serviceFor(database).reserveNext("worker_3")).toBeUndefined();
  });

  it("applique les transitions légales et protège la lease", () => {
    const database = createFixture();
    const service = new ExecutionService(database, { leaseDurationMs: 1_000 });
    service.enqueue(request());
    service.reserveNext("worker_1", "2026-01-01T00:00:00.000Z");

    expect(() =>
      service.transition("exec_1", "succeeded", {
        workerId: "worker_2",
        now: "2026-01-01T00:00:00.100Z",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutionServiceError>>({ code: "LEASE_LOST" }),
    );
    const awaiting = service.transition("exec_1", "awaiting_approval", {
      workerId: "worker_1",
      now: "2026-01-01T00:00:00.100Z",
    });
    expect(awaiting.state).toBe("awaiting_approval");
    const running = service.transition("exec_1", "running", {
      workerId: "worker_1",
      now: "2026-01-01T00:00:00.200Z",
    });
    expect(running.state).toBe("running");
    const succeeded = service.transition("exec_1", "succeeded", {
      workerId: "worker_1",
      result: { verified: true },
      now: "2026-01-01T00:00:00.300Z",
    });
    expect(succeeded).toMatchObject({
      state: "succeeded",
      result: { verified: true },
      leaseOwner: null,
    });
    expect(() =>
      service.transition("exec_1", "running", {
        workerId: "worker_1",
        now: "2026-01-01T00:00:00.400Z",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutionServiceError>>({
        code: "INVALID_TRANSITION",
      }),
    );
  });

  it("rend l'annulation idempotente et distingue la demande de l'arrêt prouvé", () => {
    const database = createFixture();
    const service = new ExecutionService(database, { leaseDurationMs: 1_000 });
    service.enqueue(request());

    const queuedCancel = service.cancel("exec_1");
    expect(queuedCancel).toMatchObject({ status: "cancelled", changed: true });
    expect(service.cancel("exec_1")).toMatchObject({
      status: "already-finished",
      changed: false,
    });

    service.enqueue(
      request({
        id: "exec_2",
        triggerId: "trigger_2",
        idempotencyKey: "exec_req_2",
      }),
    );
    service.reserveNext("worker_1", "2026-01-01T00:00:00.000Z");
    expect(service.cancel("exec_2")).toMatchObject({
      status: "requested",
      changed: true,
      execution: { state: "running" },
    });
    expect(
      service.cancel("exec_2", {
        workerId: "worker_1",
        now: "2026-01-01T00:00:00.100Z",
      }),
    ).toMatchObject({ status: "cancelled", execution: { state: "cancelled" } });
  });

  it("réconcilie un travail en cours en unknown après un redémarrage", () => {
    const database = createFixture();
    const service = new ExecutionService(database, { leaseDurationMs: 1_000 });
    service.enqueue(request());
    service.reserveNext("worker_1", "2026-01-01T00:00:00.000Z");

    const reconciled = service.reconcileAfterRestart("2026-01-01T00:00:01.000Z");
    expect(reconciled).toMatchObject([
      {
        id: "exec_1",
        state: "unknown",
        errorCode: "EXECUTION_UNCERTAIN",
        leaseOwner: null,
      },
    ]);
    expect(service.reserveNext("worker_2")).toBeUndefined();
    expect(service.listTransitions("exec_1").map((item) => item.toState)).toEqual([
      "queued",
      "running",
      "unknown",
    ]);
  });

  it("rattache une session à la même exécution sans changer son projet", () => {
    const database = createFixture();
    const service = new ExecutionService(database);
    service.enqueue(request());

    const session = service.createSession({
      id: "session_1",
      executionId: "exec_1",
      provider: "fake",
      providerSessionKey: "fake-session-1",
      providerVersion: "fake-1.0.0",
    });
    expect(session).toMatchObject({
      id: "session_1",
      projectId: "prj_1",
      assignmentId: "asgn_1",
      provider: "fake",
    });
    expect(
      service.createSession({
        executionId: "exec_1",
        provider: "fake",
        providerSessionKey: "fake-session-1",
        providerVersion: "fake-1.0.0",
      }),
    ).toEqual(session);

    service.enqueue(
      request({
        id: "exec_2",
        projectId: "prj_2",
        assignmentId: "asgn_2",
        triggerId: "trigger_2",
        idempotencyKey: "exec_req_2",
      }),
    );
    expect(() =>
      service.createSession({
        executionId: "exec_2",
        provider: "fake",
        providerSessionKey: "fake-session-1",
        providerVersion: "fake-1.0.0",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ExecutionServiceError>>({ code: "CONFLICT" }),
    );
  });
});

function serviceFor(database: ReturnType<typeof openDatabase>) {
  return new ExecutionService(database);
}
