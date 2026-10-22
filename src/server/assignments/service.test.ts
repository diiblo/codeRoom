import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { AuthorizationService } from "../security/authorization.js";
import { AssignmentService, AssignmentServiceError } from "./service.js";

describe("assignment service", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: AssignmentService;

  beforeEach(() => {
    database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    repository.createAgent({
      id: "agt_1",
      provider: "codex",
      displayName: "Developer",
      role: "developer",
    });
    repository.createAgent({
      id: "agt_2",
      provider: "codex",
      displayName: "Reviewer",
      role: "reviewer",
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
    service = new AssignmentService(database);
  });

  afterEach(() => database.close());

  it("isole deux projets pour le même agent et rend la création idempotente", () => {
    const first = service.createAssignment({
      id: "asgn_1",
      projectId: "prj_1",
      agentId: "agt_1",
      provider: "codex",
      permissionSet: ["message.send", "project.read"],
      idempotencyKey: "req_1",
    });
    const repeated = service.createAssignment({
      id: "asgn_1",
      projectId: "prj_1",
      agentId: "agt_1",
      permissionSet: ["project.read", "message.send"],
      idempotencyKey: "req_1",
    });
    expect(repeated).toEqual(first);

    const secondProject = service.createAssignment({
      id: "asgn_2",
      projectId: "prj_2",
      agentId: "agt_1",
      provider: "antigravity",
      permissionSet: ["project.read"],
      idempotencyKey: "req_2",
    });
    expect(secondProject).toMatchObject({
      projectId: "prj_2",
      agentId: "agt_1",
      provider: "antigravity",
      permissionSet: ["project.read"],
    });
    expect(service.listAssignments({ projectId: "prj_1" })).toMatchObject([
      { id: "asgn_1", projectId: "prj_1" },
    ]);
    expect(service.listAssignments({ projectId: "prj_2" })).toMatchObject([
      { id: "asgn_2", projectId: "prj_2" },
    ]);
    expect(() =>
      service.createAssignment({
        id: "asgn_duplicate",
        projectId: "prj_1",
        agentId: "agt_1",
        permissionSet: [],
        idempotencyKey: "req_duplicate",
      }),
    ).toThrowError(
      new AssignmentServiceError(
        "CONFLICT",
        "An active assignment already exists for this project and agent",
      ),
    );
  });

  it("applique la révocation des permissions dans l'autorisation", () => {
    service.createAssignment({
      id: "asgn_1",
      projectId: "prj_1",
      agentId: "agt_1",
      permissionSet: ["message.send"],
      idempotencyKey: "req_1",
    });
    const authorize = new AuthorizationService(database);
    const identity = { type: "agent" as const, id: "agt_1", assignmentId: "asgn_1" };

    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "message.send",
        identity,
      }),
    ).toMatchObject({ allowed: true });

    const updated = service.updatePermissions({
      assignmentId: "asgn_1",
      permissionSet: ["project.read"],
    });
    expect(updated.permissionSet).toEqual(["project.read"]);
    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "message.send",
        identity,
      }),
    ).toMatchObject({
      allowed: false,
      reason: "permission_not_granted",
    });
    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "project.read",
        identity,
      }),
    ).toMatchObject({ allowed: true });

    const archived = service.archiveAssignment("asgn_1");
    expect(archived.status).toBe("archived");
    expect(
      authorize.authorize({
        projectId: "prj_1",
        permission: "project.read",
        identity,
      }),
    ).toMatchObject({
      allowed: false,
      reason: "assignment_not_active",
    });
    expect(service.listAssignments({ projectId: "prj_1" })).toHaveLength(0);
    expect(
      service.listAssignments({ projectId: "prj_1", includeArchived: true }),
    ).toMatchObject([{ id: "asgn_1", status: "archived" }]);
  });

  it("conserve le fournisseur choisi dans le contexte projet", () => {
    const assignment = service.createAssignment({
      id: "asgn_provider",
      projectId: "prj_1",
      agentId: "agt_1",
      provider: "opencode",
      permissionSet: ["project.read"],
      idempotencyKey: "req_provider",
    });

    expect(service.listAssignments({ projectId: "prj_1" })).toContainEqual(
      expect.objectContaining({ id: assignment.id, provider: "opencode" }),
    );
  });

  it("réautorise une nouvelle affectation après archivage et refuse les contextes invalides", () => {
    service.createAssignment({
      id: "asgn_1",
      projectId: "prj_1",
      agentId: "agt_1",
      permissionSet: [],
      idempotencyKey: "req_1",
    });
    service.archiveAssignment("asgn_1");
    const replacement = service.createAssignment({
      id: "asgn_2",
      projectId: "prj_1",
      agentId: "agt_1",
      permissionSet: ["project.read"],
      idempotencyKey: "req_2",
    });
    expect(replacement).toMatchObject({ id: "asgn_2", status: "active" });

    database
      .prepare("UPDATE projects SET status = 'archived' WHERE id = ?")
      .run("prj_2");
    expect(() =>
      service.createAssignment({
        id: "asgn_3",
        projectId: "prj_2",
        agentId: "agt_2",
        permissionSet: [],
        idempotencyKey: "req_3",
      }),
    ).toThrowError(
      new AssignmentServiceError(
        "FORBIDDEN",
        "Archived projects cannot receive assignment changes",
      ),
    );
    expect(() =>
      service.updatePermissions({
        assignmentId: "asgn_1",
        permissionSet: ["message.send"],
      }),
    ).toThrowError(
      new AssignmentServiceError("FORBIDDEN", "Archived assignments are not mutable"),
    );
  });

  it("valide les permissions et les références", () => {
    expect(() =>
      service.createAssignment({
        id: "asgn_1",
        projectId: "prj_1",
        agentId: "agt_1",
        permissionSet: ["approval.resolve"],
        idempotencyKey: "req_1",
      }),
    ).toThrowError(
      new AssignmentServiceError(
        "VALIDATION_ERROR",
        "Unknown permission: approval.resolve",
      ),
    );
    expect(() =>
      service.createAssignment({
        id: "asgn_1",
        projectId: "prj_missing",
        agentId: "agt_1",
        permissionSet: [],
        idempotencyKey: "req_1",
      }),
    ).toThrowError(new AssignmentServiceError("NOT_FOUND", "Project not found"));
    expect(() =>
      service.createAssignment({
        id: "asgn_1",
        projectId: "prj_1",
        agentId: "agt_missing",
        permissionSet: [],
        idempotencyKey: "req_1",
      }),
    ).toThrowError(new AssignmentServiceError("NOT_FOUND", "Agent not found"));
  });
});
