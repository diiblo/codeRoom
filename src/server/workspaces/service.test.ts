import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ExecutionService } from "../executions/service.js";
import { ProjectRepositoryService } from "../projects/repository-service.js";
import { ProjectService } from "../projects/service.js";
import { TicketService } from "../tickets/service.js";
import {
  WorkspaceService,
  WorkspaceServiceError,
  type AcquireWorkspaceLockInput,
} from "./service.js";

const temporaryDirectories: string[] = [];

function createGitRepository(parent: string, name = "repo") {
  const repositoryPath = join(parent, name);
  const gitPath = join(repositoryPath, ".git");
  mkdirSync(join(gitPath, "objects"), { recursive: true });
  mkdirSync(join(gitPath, "refs"), { recursive: true });
  writeFileSync(join(gitPath, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(gitPath, "config"), "[core]\n");
  return repositoryPath;
}

describe("WorkspaceService", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: WorkspaceService;
  let repositoryPath: string;
  let workspaceId: string;
  let ticketWorkspaceId: string;

  beforeEach(() => {
    database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    const projects = new ProjectService(database);
    projects.createProject({
      id: "prj_1",
      organizationId: "org_1",
      name: "One",
      idempotencyKey: "project_1",
    });
    projects.createProject({
      id: "prj_2",
      organizationId: "org_1",
      name: "Two",
      idempotencyKey: "project_2",
    });
    const parent = mkdtempSync(join(tmpdir(), "coderoom-workspaces-"));
    temporaryDirectories.push(parent);
    repositoryPath = createGitRepository(parent);
    const repositories = new ProjectRepositoryService(database);
    repositories.linkRepository({
      projectId: "prj_1",
      path: repositoryPath,
      idempotencyKey: "repository_1",
      actor: { type: "human", id: "owner_1" },
      correlationId: "repository_corr_1",
    });
    repository.createAgent({
      id: "agent_1",
      provider: "fake",
      displayName: "One",
      role: "developer",
    });
    repository.createAgent({
      id: "agent_2",
      provider: "fake",
      displayName: "Two",
      role: "developer",
    });
    repository.createAssignment({
      id: "assignment_1",
      projectId: "prj_1",
      agentId: "agent_1",
      permissionSet: ["git.write_scoped"],
    });
    repository.createAssignment({
      id: "assignment_2",
      projectId: "prj_2",
      agentId: "agent_2",
      permissionSet: ["git.write_scoped"],
    });
    const executions = new ExecutionService(database);
    executions.enqueue({
      id: "execution_1",
      projectId: "prj_1",
      assignmentId: "assignment_1",
      triggerId: "trigger_1",
      instruction: "Work in the repository",
      contextRefs: ["project:prj_1"],
      requestedWorkspaceId: "ws_project_1",
      idempotencyKey: "execution_request_1",
    });
    executions.enqueue({
      id: "execution_2",
      projectId: "prj_2",
      assignmentId: "assignment_2",
      triggerId: "trigger_2",
      instruction: "Work in another repository",
      contextRefs: ["project:prj_2"],
      idempotencyKey: "execution_request_2",
    });
    new TicketService(database).createTicket({
      id: "ticket_1",
      projectId: "prj_1",
      title: "Workspace ticket",
      body: "Reserve the repository safely",
      author: { type: "human", id: "owner_1" },
      acceptanceCriteria: ["The lock is persisted"],
      idempotencyKey: "ticket_1",
    });
    service = new WorkspaceService(database, {
      now: () => "2026-01-01T00:00:00.000Z",
      defaultLeaseDurationMs: 1_000,
    });
    workspaceId = "ws_project_1";
    ticketWorkspaceId = "ws_ticket_1";
  });

  afterEach(() => {
    database.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function allocateProject() {
    return service.allocate({
      id: workspaceId,
      projectId: "prj_1",
      idempotencyKey: "workspace_1",
      actor: { type: "human", id: "owner_1" },
      correlationId: "workspace_corr_1",
    });
  }

  function acquire(
    overrides: Partial<AcquireWorkspaceLockInput> = {},
  ): AcquireWorkspaceLockInput {
    return {
      workspaceId,
      ownerId: "execution_1",
      idempotencyKey: "lock_1",
      actor: { type: "system", id: "worker_1" },
      correlationId: "lock_corr_1",
      now: "2026-01-01T00:00:00.000Z",
      leaseDurationMs: 1_000,
      ...overrides,
    };
  }

  it("alloue un workspace projet ou ticket sans cloner ni effacer le dépôt", () => {
    const projectWorkspace = allocateProject();
    const ticketWorkspace = service.allocate({
      id: ticketWorkspaceId,
      projectId: "prj_1",
      ticketId: "ticket_1",
      idempotencyKey: "workspace_ticket_1",
    });

    expect(projectWorkspace).toMatchObject({
      id: workspaceId,
      projectId: "prj_1",
      ticketId: null,
      repositoryPath,
      workspacePath: repositoryPath,
      strategy: "shared_repository",
      status: "active",
    });
    expect(ticketWorkspace).toMatchObject({
      id: ticketWorkspaceId,
      projectId: "prj_1",
      ticketId: "ticket_1",
      workspacePath: repositoryPath,
    });
    expect(
      service.allocate({
        id: workspaceId,
        projectId: "prj_1",
        idempotencyKey: "workspace_1",
      }),
    ).toEqual(projectWorkspace);

    const unknownFile = join(repositoryPath, "user-data.txt");
    writeFileSync(unknownFile, "preserve me");
    service.retire(ticketWorkspaceId, { type: "human", id: "owner_1" });
    expect(existsSync(unknownFile)).toBe(true);
    expect(service.listWorkspaces("prj_1", true)).toContainEqual(
      expect.objectContaining({ id: ticketWorkspaceId, status: "retired" }),
    );
  });

  it("refuse une allocation sans dépôt ou cross-project et protège l'idempotence", () => {
    expect(() =>
      service.allocate({
        projectId: "prj_2",
        idempotencyKey: "workspace_missing_repo",
      }),
    ).toThrowError(
      new WorkspaceServiceError("CONFLICT", "Project has no repository linked"),
    );

    const first = allocateProject();
    expect(() =>
      service.allocate({
        id: "ws_other",
        projectId: "prj_1",
        idempotencyKey: "workspace_1",
      }),
    ).toThrowError(
      new WorkspaceServiceError(
        "CONFLICT",
        "Idempotency key was already used for another workspace allocation",
      ),
    );
    expect(service.getWorkspace(first.id)).toEqual(first);
    expect(() => service.getWorkspace("unknown")).not.toThrow();
  });

  it("refuse un dépôt remplacé par un symlink après sa liaison", () => {
    const parent = temporaryDirectories[0];
    const externalRepository = createGitRepository(parent, "external");
    rmSync(repositoryPath, { recursive: true, force: true });
    symlinkSync(externalRepository, repositoryPath, "dir");

    expect(() => allocateProject()).toThrowError(
      new WorkspaceServiceError(
        "CONFLICT",
        "Linked repository is no longer an authorized workspace",
      ),
    );
  });

  it("rejette le second writer sur le même dépôt, même avec deux workspaces", () => {
    allocateProject();
    const ticketWorkspace = service.allocate({
      id: ticketWorkspaceId,
      projectId: "prj_1",
      ticketId: "ticket_1",
      idempotencyKey: "workspace_ticket_1",
    });
    const first = service.acquireLock(acquire());

    expect(() =>
      service.acquireLock(
        acquire({
          workspaceId: ticketWorkspace.id,
          ownerId: "execution_2",
          idempotencyKey: "lock_2",
        }),
      ),
    ).toThrowError(
      new WorkspaceServiceError(
        "CONFLICT",
        "Workspace is already locked by another writer",
      ),
    );

    const released = service.releaseLock({
      workspaceId,
      ownerId: "execution_1",
      lockToken: first.lockToken,
      actor: { type: "system", id: "worker_1" },
      correlationId: "release_1",
      now: "2026-01-01T00:00:00.500Z",
    });
    expect(released.status).toBe("released");
    expect(
      service.acquireLock(
        acquire({
          workspaceId: ticketWorkspace.id,
          ownerId: "execution_2",
          idempotencyKey: "lock_2",
        }),
      ),
    ).toMatchObject({ status: "held", workspaceId: ticketWorkspace.id });
  });

  it("sérialise deux acquisitions concurrentes sur le même dépôt", async () => {
    allocateProject();
    const secondService = new WorkspaceService(database, {
      now: () => "2026-01-01T00:00:00.000Z",
      defaultLeaseDurationMs: 1_000,
    });
    const results = await Promise.allSettled([
      Promise.resolve().then(() =>
        service.acquireLock(acquire({ idempotencyKey: "lock_concurrent_1" })),
      ),
      Promise.resolve().then(() =>
        secondService.acquireLock(
          acquire({ ownerId: "execution_2", idempotencyKey: "lock_concurrent_2" }),
        ),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        code: "CONFLICT",
        message: "Workspace is already locked by another writer",
      }),
    });
  });

  it("marque une lease expirée comme incertaine et exige une réconciliation", () => {
    allocateProject();
    service.acquireLock(acquire());

    expect(() =>
      service.acquireLock(
        acquire({
          ownerId: "execution_2",
          idempotencyKey: "lock_2",
          now: "2026-01-01T00:00:02.000Z",
        }),
      ),
    ).toThrowError(
      new WorkspaceServiceError(
        "LEASE_LOST",
        "Workspace lease expired and requires explicit reconciliation",
      ),
    );
    expect(
      database
        .prepare("SELECT status FROM git_workspace_locks WHERE repository_path = ?")
        .get(repositoryPath),
    ).toEqual({ status: "reconciliation_required" });

    expect(() =>
      service.acquireLock(
        acquire({
          ownerId: "execution_3",
          idempotencyKey: "lock_3",
          now: "2026-01-01T00:00:03.000Z",
        }),
      ),
    ).toThrowError(
      new WorkspaceServiceError(
        "CONFLICT",
        "Workspace requires explicit lock reconciliation",
      ),
    );

    service.reconcileLock({
      workspaceId,
      actor: { type: "human", id: "owner_1" },
      reason: "Worker process was confirmed stopped",
      correlationId: "reconcile_1",
      now: "2026-01-01T00:00:04.000Z",
    });
    expect(
      service.acquireLock(
        acquire({
          ownerId: "execution_3",
          idempotencyKey: "lock_3",
          now: "2026-01-01T00:00:04.000Z",
        }),
      ),
    ).toMatchObject({ status: "held", ownerId: "execution_3" });
  });

  it("recoupe l'exécution au projet et au workspace réservé", () => {
    allocateProject();
    expect(() =>
      service.acquireLock(acquire({ executionId: "execution_2" })),
    ).toThrowError(
      new WorkspaceServiceError("CONFLICT", "Execution belongs to another project"),
    );
  });

  it("rend acquisition et release idempotents et refuse un token étranger", () => {
    allocateProject();
    const first = service.acquireLock(acquire());
    expect(service.acquireLock(acquire())).toEqual(first);

    expect(() =>
      service.releaseLock({
        workspaceId,
        ownerId: "execution_2",
        lockToken: first.lockToken,
      }),
    ).toThrowError(
      new WorkspaceServiceError("LEASE_LOST", "Workspace lock is not owned by caller"),
    );

    const released = service.releaseLock({
      workspaceId,
      ownerId: "execution_1",
      lockToken: first.lockToken,
      now: "2026-01-01T00:00:00.500Z",
    });
    expect(
      service.releaseLock({
        workspaceId,
        ownerId: "execution_1",
        lockToken: first.lockToken,
        now: "2026-01-01T00:00:00.600Z",
      }),
    ).toEqual(released);
  });

  it("ne retire pas un workspace dont le verrou reste détenu", () => {
    allocateProject();
    const lock = service.acquireLock(acquire());
    expect(() => service.retire(workspaceId)).toThrowError(
      new WorkspaceServiceError(
        "CONFLICT",
        "Workspace cannot be retired while its lock is held",
      ),
    );
    service.releaseLock({
      workspaceId,
      ownerId: "execution_1",
      lockToken: lock.lockToken,
      now: "2026-01-01T00:00:00.500Z",
    });
    expect(service.retire(workspaceId).status).toBe("retired");
  });

  it("refuse une réconciliation proposée par un agent", () => {
    allocateProject();
    service.acquireLock(acquire());
    expect(() =>
      service.reconcileLock({
        workspaceId,
        actor: { type: "agent", id: "agent_1" },
        reason: "Attempted automatic recovery",
        now: "2026-01-01T00:00:02.000Z",
      }),
    ).toThrowError(
      new WorkspaceServiceError(
        "FORBIDDEN",
        "Human reconciliation is required for an uncertain workspace lock",
      ),
    );
  });
});
