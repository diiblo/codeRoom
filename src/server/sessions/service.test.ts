import { afterEach, describe, expect, it } from "vitest";
import { AuthorizationService } from "../security/authorization.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ExecutionService } from "../executions/service.js";
import { SessionService, SessionServiceError } from "./service.js";

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
    displayName: "Shared agent",
    role: "developer",
  });
  repository.createProject({ id: "prj_1", organizationId: "org_1", name: "One" });
  repository.createProject({ id: "prj_2", organizationId: "org_1", name: "Two" });
  repository.createAssignment({
    id: "asgn_1",
    projectId: "prj_1",
    agentId: "agt_1",
    permissionSet: ["execution.request"],
  });
  repository.createAssignment({
    id: "asgn_2",
    projectId: "prj_2",
    agentId: "agt_1",
    permissionSet: ["execution.request"],
  });
  return database;
}

function enqueue(
  service: ExecutionService,
  projectId: string,
  assignmentId: string,
  suffix: string,
) {
  return service.enqueue({
    id: `exec_${suffix}`,
    projectId,
    assignmentId,
    triggerId: `trigger_${suffix}`,
    instruction: "Inspect the repository",
    contextRefs: [`project:${projectId}`],
    idempotencyKey: `request_${suffix}`,
  });
}

describe("SessionService", () => {
  it("isole deux sessions du même agent entre deux projets", () => {
    const database = createFixture();
    const executions = new ExecutionService(database);
    const firstExecution = enqueue(executions, "prj_1", "asgn_1", "one");
    const secondExecution = enqueue(executions, "prj_2", "asgn_2", "two");

    const first = executions.createSession({
      executionId: firstExecution.id,
      provider: "fake",
      providerSessionKey: "fake-project-one",
    });
    const second = executions.createSession({
      executionId: secondExecution.id,
      provider: "fake",
      providerSessionKey: "fake-project-two",
    });

    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      projectId: "prj_1",
      assignmentId: "asgn_1",
      status: "active",
      contextScope: { projectId: "prj_1", assignmentId: "asgn_1" },
    });
    expect(second).toMatchObject({
      projectId: "prj_2",
      assignmentId: "asgn_2",
      status: "active",
      contextScope: { projectId: "prj_2", assignmentId: "asgn_2" },
    });
  });

  it("refuse une reprise avec le projet ou l'affectation d'un autre contexte", () => {
    const database = createFixture();
    const executions = new ExecutionService(database);
    const execution = enqueue(executions, "prj_1", "asgn_1", "one");
    const session = executions.createSession({
      executionId: execution.id,
      provider: "fake",
      providerSessionKey: "fake-project-one",
    });
    const sessions = new SessionService(database, new AuthorizationService(database));

    expect(() =>
      sessions.prepareResume({
        sessionId: session.id,
        projectId: "prj_2",
        assignmentId: "asgn_2",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_2" },
        nativeResume: "supported",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SessionServiceError>>({ code: "FORBIDDEN" }),
    );
  });

  it("vérifie le droit et la capacité avant reprise puis révoque idempotemment", () => {
    const database = createFixture();
    const executions = new ExecutionService(database);
    const execution = enqueue(executions, "prj_1", "asgn_1", "one");
    const session = executions.createSession({
      executionId: execution.id,
      provider: "fake",
      providerSessionKey: "fake-project-one",
    });
    const sessions = new SessionService(database, new AuthorizationService(database));
    const identity = { type: "agent" as const, id: "agt_1", assignmentId: "asgn_1" };

    expect(
      sessions.prepareResume({
        sessionId: session.id,
        projectId: "prj_1",
        assignmentId: "asgn_1",
        identity,
        nativeResume: "supported",
      }),
    ).toEqual(session);
    expect(() =>
      sessions.prepareResume({
        sessionId: session.id,
        projectId: "prj_1",
        assignmentId: "asgn_1",
        identity,
        nativeResume: "unverified",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SessionServiceError>>({
        code: "CAPABILITY_UNAVAILABLE",
      }),
    );

    const revoked = sessions.revokeSession(session.id, {
      now: "2026-01-01T00:00:00.000Z",
    });
    expect(revoked.status).toBe("revoked");
    expect(
      sessions.revokeSession(session.id, { now: "2026-01-01T00:00:01.000Z" }),
    ).toEqual(revoked);
    expect(() =>
      sessions.prepareResume({
        sessionId: session.id,
        projectId: "prj_1",
        assignmentId: "asgn_1",
        identity,
        nativeResume: "supported",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SessionServiceError>>({ code: "CONFLICT" }),
    );
  });
});
