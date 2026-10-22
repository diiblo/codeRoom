import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCoreRepository } from "../db/repository.js";
import { openDatabase } from "../db/database.js";
import { AuthorizationService, type AuthorizationDecision } from "./authorization.js";

describe("server authorization policy", () => {
  let database: ReturnType<typeof openDatabase>;
  let authorize: AuthorizationService;

  beforeEach(() => {
    database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    repository.createAgent({
      id: "agt_1",
      provider: "codex",
      displayName: "Developer",
      role: "admin",
    });
    repository.createAgent({
      id: "agt_2",
      provider: "codex",
      displayName: "Reviewer",
      role: "admin",
    });
    repository.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "One",
    });
    repository.createProject({
      id: "prj_2",
      organizationId: "org_1",
      name: "Two",
    });
    repository.createAssignment({
      id: "asgn_1",
      projectId: "prj_1",
      agentId: "agt_1",
      permissionSet: ["message.send"],
    });
    repository.createAssignment({
      id: "asgn_2",
      projectId: "prj_2",
      agentId: "agt_1",
      permissionSet: ["project.read"],
    });
    repository.createAssignment({
      id: "asgn_3",
      projectId: "prj_1",
      agentId: "agt_2",
      permissionSet: [],
    });
    authorize = new AuthorizationService(database);
  });

  afterEach(() => database.close());

  it("refuse par défaut une identité absente et ne confond pas rôle et permission", () => {
    expect(
      authorize.authorize({ projectId: "prj_1", permission: "message.send" }),
    ).toMatchObject({
      allowed: false,
      code: "UNAUTHORIZED",
      reason: "missing_identity",
    });

    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "message.send",
        identity: { type: "agent", id: "agt_2", assignmentId: "asgn_3" },
      }),
    ).toMatchObject({
      allowed: false,
      code: "FORBIDDEN",
      reason: "permission_not_granted",
    });
  });

  it("autorise uniquement l'affectation active du bon projet", () => {
    const decisions: AuthorizationDecision[] = [];
    authorize = new AuthorizationService(database, (decision) => {
      decisions.push(decision);
    });

    const decision = authorize.authorize({
      projectId: "prj_1",
      permission: "message.send",
      identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      correlationId: "corr_1",
    });

    expect(decision).toMatchObject({
      allowed: true,
      code: "AUTHORIZED",
      reason: "authorized",
      actorId: "agt_1",
      projectId: "prj_1",
      assignmentId: "asgn_1",
      correlationId: "corr_1",
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toEqual(decision);
  });

  it("refuse une référence cross-project même si l'agent est membre ailleurs", () => {
    expect(
      authorize.authorize({
        projectId: "prj_2",
        permission: "message.send",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "assignment_not_found",
    });

    expect(
      authorize.authorize({
        projectId: "prj_2",
        permission: "message.send",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_2" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "permission_not_granted",
    });
  });

  it("refuse une affectation révoquée", () => {
    database
      .prepare(
        "UPDATE assignments SET status = 'archived', archived_at = ? WHERE id = ?",
      )
      .run(new Date().toISOString(), "asgn_1");

    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "message.send",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
      }),
    ).toMatchObject({
      allowed: false,
      reason: "assignment_not_active",
    });
  });

  it("refuse un actorId injecté différent de l'identité serveur", () => {
    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "message.send",
        identity: { type: "agent", id: "agt_1", assignmentId: "asgn_1" },
        untrustedActorId: "agt_2",
      }),
    ).toMatchObject({
      allowed: false,
      code: "FORBIDDEN",
      reason: "actor_id_mismatch",
    });
  });

  it("refuse les identités humaines ou système sans politique de membership", () => {
    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "message.send",
        identity: { type: "human", id: "usr_1" },
      }),
    ).toMatchObject({ allowed: false, reason: "unsupported_identity" });
    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "message.send",
        identity: { type: "system", id: "system" },
      }),
    ).toMatchObject({ allowed: false, reason: "unsupported_identity" });
  });
});
