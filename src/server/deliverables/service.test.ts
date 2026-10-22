import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { EventService } from "../events/service.js";
import { ExecutionService } from "../executions/service.js";
import { ProjectRepositoryService } from "../projects/repository-service.js";
import { TicketService } from "../tickets/service.js";
import { WorkspaceService } from "../workspaces/service.js";
import {
  DeliverableService,
  DeliverableServiceError,
  type GitInspectionProvider,
  type SubmitDeliverableInput,
  type TestEvidenceInput,
} from "./service.js";

const CLOCK = "2026-01-01T00:00:00.000Z";
const temporaryDirectories: string[] = [];

function createGitRepository(parent: string) {
  const repositoryPath = join(parent, "repo");
  const gitPath = join(repositoryPath, ".git");
  mkdirSync(join(gitPath, "objects"), { recursive: true });
  mkdirSync(join(gitPath, "refs"), { recursive: true });
  writeFileSync(join(gitPath, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(gitPath, "config"), "[core]\n");
  return repositoryPath;
}

function createEvidence(
  id: string,
  overrides: Partial<TestEvidenceInput> = {},
): TestEvidenceInput {
  return {
    id,
    command: "npm test -- --runInBand",
    source: "runner",
    outcome: "passed",
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    startedAt: CLOCK,
    finishedAt: "2026-01-01T00:00:01.000Z",
    ...overrides,
  };
}

describe("DeliverableService", () => {
  let database: ReturnType<typeof openDatabase>;
  let service: DeliverableService;
  let repositoryPath: string;
  let lockToken: string;

  beforeEach(() => {
    database = openDatabase(":memory:");
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_1", name: "Local" });
    repository.createProject({ id: "prj_1", organizationId: "org_1", name: "One" });
    repository.createAgent({
      id: "agent_1",
      provider: "fake",
      displayName: "One",
      role: "developer",
    });
    repository.createAssignment({
      id: "assignment_1",
      projectId: "prj_1",
      agentId: "agent_1",
      permissionSet: ["git.write_scoped"],
    });

    const parent = mkdtempSync(join(tmpdir(), "coderoom-deliverables-"));
    temporaryDirectories.push(parent);
    repositoryPath = createGitRepository(parent);
    new ProjectRepositoryService(database).linkRepository({
      projectId: "prj_1",
      path: repositoryPath,
      idempotencyKey: "repository_1",
      actor: { type: "human", id: "owner_1" },
      correlationId: "repository_corr_1",
    });

    new TicketService(database).createTicket({
      id: "ticket_1",
      projectId: "prj_1",
      title: "Capture the result",
      body: "Store the Git and test provenance.",
      author: { type: "human", id: "owner_1" },
      acceptanceCriteria: ["The result is reviewable"],
      idempotencyKey: "ticket_1",
      now: CLOCK,
    });
    new ExecutionService(database).enqueue({
      id: "execution_1",
      projectId: "prj_1",
      assignmentId: "assignment_1",
      triggerId: "trigger_1",
      instruction: "Inspect the repository",
      contextRefs: ["project:prj_1"],
      requestedWorkspaceId: "workspace_1",
      idempotencyKey: "execution_1",
    });

    const workspaces = new WorkspaceService(database, {
      now: () => CLOCK,
      defaultLeaseDurationMs: 60_000,
    });
    workspaces.allocate({
      id: "workspace_1",
      projectId: "prj_1",
      idempotencyKey: "workspace_1",
    });
    lockToken = workspaces.acquireLock({
      workspaceId: "workspace_1",
      ownerId: "execution_1",
      executionId: "execution_1",
      idempotencyKey: "lock_1",
      leaseDurationMs: 60_000,
      now: CLOCK,
    }).lockToken;

    const inspector: GitInspectionProvider = {
      inspect({ workspace, requestedRef }) {
        if (requestedRef === "refs/heads/missing") {
          throw new DeliverableServiceError("NOT_FOUND", "Git ref not found");
        }
        return {
          repositoryPath: workspace.repositoryPath,
          gitRef: requestedRef ?? "refs/heads/main",
          commit: "a".repeat(40),
          branch: "main",
          workingTreeStatus: "dirty",
          diff: "diff --git a/config b/config\n+password=secret-value\n",
          refVerified: true,
        };
      },
    };
    service = new DeliverableService(database, {
      gitInspector: inspector,
      now: () => CLOCK,
    });
  });

  afterEach(() => {
    database.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createInput(
    overrides: Partial<SubmitDeliverableInput> = {},
  ): SubmitDeliverableInput {
    return {
      id: "deliverable_1",
      ticketId: "ticket_1",
      executionId: "execution_1",
      workspaceId: "workspace_1",
      lockToken,
      requestedRef: "refs/heads/main",
      testEvidence: [
        createEvidence("evidence_1", {
          stdout: "token=secret-value\nall tests passed",
        }),
      ],
      actor: { type: "agent", id: "agent_1" },
      idempotencyKey: "deliverable_request_1",
      correlationId: "deliverable_corr_1",
      now: CLOCK,
      ...overrides,
    };
  }

  it("capture la provenance Git et les preuves de test avec redaction", () => {
    const deliverable = service.submit(createInput());

    expect(deliverable).toMatchObject({
      id: "deliverable_1",
      ticketId: "ticket_1",
      executionId: "execution_1",
      projectId: "prj_1",
      workspaceId: "workspace_1",
      repositoryPath,
      gitRef: "refs/heads/main",
      gitCommit: "a".repeat(40),
      workingTreeStatus: "dirty",
      state: "submitted",
      submittedBy: { type: "agent", id: "agent_1" },
    });
    expect(deliverable.diff).toContain("password=[REDACTED]");
    expect(deliverable.diff).not.toContain("secret-value");
    expect(deliverable.testEvidence).toMatchObject([
      {
        source: "runner",
        outcome: "passed",
        exitCode: 0,
        stdout: "token=[REDACTED]\nall tests passed",
        durationMs: 1_000,
      },
    ]);
    expect(service.getDeliverable("deliverable_1")).toEqual(deliverable);
    expect(new EventService(database).listEvents({ projectId: "prj_1" }).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deliverable.submitted",
          payload: expect.objectContaining({
            deliverableId: "deliverable_1",
            testOutcomes: ["passed"],
          }),
        }),
      ]),
    );
    expect(service.listByTicket("ticket_1")).toEqual([deliverable]);
  });

  it("conserve explicitement une preuve de test en échec", () => {
    const deliverable = service.submit(
      createInput({
        id: "deliverable_failed",
        idempotencyKey: "deliverable_failed_request",
        testEvidence: [
          createEvidence("evidence_failed", {
            outcome: "failed",
            exitCode: 1,
            stderr: "1 assertion failed",
          }),
        ],
      }),
    );

    expect(deliverable.testEvidence[0]).toMatchObject({
      outcome: "failed",
      exitCode: 1,
      stderr: "1 assertion failed",
    });
  });

  it("rend la soumission idempotente et refuse une réutilisation divergente", () => {
    const input = createInput({
      id: undefined,
      testEvidence: [createEvidence("generated-on-submit", { id: undefined })],
    });
    const first = service.submit(input);
    expect(service.submit(input)).toEqual(first);

    expect(() =>
      service.submit(
        createInput({
          requestedRef: "refs/heads/other",
        }),
      ),
    ).toThrowError(
      new DeliverableServiceError(
        "CONFLICT",
        "Idempotency key was already used for another deliverable",
      ),
    );
  });

  it("rejette une référence non vérifiée et reste fermé sans inspecteur", () => {
    expect(() =>
      service.submit(
        createInput({
          id: "deliverable_missing_ref",
          idempotencyKey: "deliverable_missing_ref_request",
          requestedRef: "refs/heads/missing",
        }),
      ),
    ).toThrowError(new DeliverableServiceError("NOT_FOUND", "Git ref not found"));

    expect(() =>
      service.submit(
        createInput({
          id: "deliverable_unsafe_ref",
          idempotencyKey: "deliverable_unsafe_ref_request",
          requestedRef: "refs/heads/../main",
        }),
      ),
    ).toThrowError(
      new DeliverableServiceError("VALIDATION_ERROR", "Git ref is unsafe"),
    );

    const unavailable = new DeliverableService(database, { now: () => CLOCK });
    expect(() =>
      unavailable.submit(
        createInput({
          id: "deliverable_without_provider",
          idempotencyKey: "deliverable_without_provider_request",
        }),
      ),
    ).toThrowError(
      new DeliverableServiceError(
        "CAPABILITY_UNAVAILABLE",
        "Git inspection requires an approved runner provider",
      ),
    );
  });

  it("refuse un lock perdu et une preuve produite hors runner", () => {
    expect(() =>
      service.submit(
        createInput({
          id: "deliverable_wrong_lock",
          idempotencyKey: "deliverable_wrong_lock_request",
          lockToken: "wrong-token",
        }),
      ),
    ).toThrowError(
      new DeliverableServiceError(
        "LEASE_LOST",
        "Workspace lock is not owned by caller",
      ),
    );

    expect(() =>
      service.submit(
        createInput({
          id: "deliverable_untrusted_evidence",
          idempotencyKey: "deliverable_untrusted_evidence_request",
          testEvidence: [
            createEvidence("evidence_untrusted", {
              source: "agent" as never,
            }),
          ],
        }),
      ),
    ).toThrowError(
      new DeliverableServiceError(
        "FORBIDDEN",
        "Test evidence must come from the controlled runner",
      ),
    );
  });

  it("refuse une incohérence entre état déclaré et code de sortie", () => {
    expect(() =>
      service.submit(
        createInput({
          id: "deliverable_invalid_evidence",
          idempotencyKey: "deliverable_invalid_evidence_request",
          testEvidence: [
            createEvidence("evidence_invalid", { outcome: "failed", exitCode: 0 }),
          ],
        }),
      ),
    ).toThrowError(
      new DeliverableServiceError(
        "VALIDATION_ERROR",
        "A failed test evidence must have a non-zero exit code",
      ),
    );
  });
});
