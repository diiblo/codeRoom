import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ProjectService, ProjectServiceError } from "./service.js";

describe("project service", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: ProjectService;

  beforeEach(() => {
    database = openDatabase(":memory:");
    createCoreRepository(database).createOrganization({
      id: "org_1",
      name: "Local",
    });
    service = new ProjectService(database);
  });

  afterEach(() => database.close());

  it("crée atomiquement un projet et son unique conversation main", () => {
    const created = service.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "Demo",
      idempotencyKey: "req_1",
    });

    expect(created.project).toMatchObject({
      id: "prj_1",
      organizationId: "org_1",
      name: "Demo",
      status: "active",
    });
    expect(created.mainConversation).toMatchObject({
      projectId: "prj_1",
      kind: "main",
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM conversations WHERE project_id = ? AND kind = 'main'",
        )
        .get("prj_1"),
    ).toMatchObject({ count: 1 });
  });

  it("rend une répétition idempotente et refuse une réutilisation contradictoire", () => {
    const first = service.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "Demo",
      idempotencyKey: "req_1",
    });
    const repeated = service.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "Demo",
      idempotencyKey: "req_1",
    });

    expect(repeated).toEqual(first);
    expect(service.listProjects({ includeArchived: true })).toHaveLength(1);
    expect(() =>
      service.createProject({
        id: "prj_2",
        organizationId: "org_1",
        name: "Other",
        idempotencyKey: "req_1",
      }),
    ).toThrowError(
      new ProjectServiceError(
        "CONFLICT",
        "Idempotency key was already used for another project request",
      ),
    );
  });

  it("annule le projet si la création de la conversation main échoue", () => {
    service.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "First",
      idempotencyKey: "req_1",
      mainConversationId: "conv_collision",
    });

    expect(() =>
      service.createProject({
        id: "prj_2",
        organizationId: "org_1",
        name: "Second",
        idempotencyKey: "req_2",
        mainConversationId: "conv_collision",
      }),
    ).toThrow();
    expect(service.listProjects({ includeArchived: true })).toHaveLength(1);
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM project_creation_requests WHERE idempotency_key = ?",
        )
        .get("req_2"),
    ).toMatchObject({ count: 0 });
  });

  it("archive un projet et rend les modifications ultérieures impossibles", () => {
    service.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "Demo",
      idempotencyKey: "req_1",
    });

    const archived = service.archiveProject("prj_1");
    expect(archived.status).toBe("archived");
    expect(service.archiveProject("prj_1")).toEqual(archived);
    expect(() =>
      service.updateProject({ projectId: "prj_1", name: "Mutated" }),
    ).toThrowError(
      new ProjectServiceError("FORBIDDEN", "Archived projects are not mutable"),
    );
    expect(service.listProjects()).toHaveLength(0);
    expect(service.listProjects({ includeArchived: true })).toMatchObject([
      { id: "prj_1", name: "Demo", status: "archived" },
    ]);
  });

  it("refuse un nom vide ou une organisation inconnue", () => {
    expect(() =>
      service.createProject({
        id: "prj_1",
        organizationId: "org_1",
        name: " ",
        idempotencyKey: "req_1",
      }),
    ).toThrowError(
      new ProjectServiceError("VALIDATION_ERROR", "name must not be empty"),
    );
    expect(() =>
      service.createProject({
        id: "prj_2",
        organizationId: "org_missing",
        name: "Demo",
        idempotencyKey: "req_2",
      }),
    ).toThrow();
    expect(service.listProjects({ includeArchived: true })).toHaveLength(0);
  });
});
