import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { DeliverableService } from "../deliverables/service.js";
import { ExecutionService } from "../executions/service.js";
import { FakeAgentAdapter } from "../adapters/fake.js";
import { ProjectRepositoryService } from "../projects/repository-service.js";
import { ReviewService } from "../reviews/service.js";
import { TicketService } from "../tickets/service.js";
import { WorkspaceService } from "../workspaces/service.js";

const CLOCK = "2026-01-01T00:00:00.000Z";
const databases: Array<ReturnType<typeof openDatabase>> = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createGitRepository(parent: string) {
  const repositoryPath = join(parent, "repo");
  const gitPath = join(repositoryPath, ".git");
  mkdirSync(join(gitPath, "objects"), { recursive: true });
  mkdirSync(join(gitPath, "refs"), { recursive: true });
  writeFileSync(join(gitPath, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(gitPath, "config"), "[core]\n");
  return repositoryPath;
}

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  repository.createProject({ id: "prj_1", organizationId: "org_1", name: "Release" });
  repository.createAgent({
    id: "agent_a",
    provider: "fake-a",
    displayName: "Agent A",
    role: "owner",
  });
  repository.createAgent({
    id: "agent_b",
    provider: "fake-b",
    displayName: "Agent B",
    role: "developer",
  });
  repository.createAssignment({
    id: "assignment_a",
    projectId: "prj_1",
    agentId: "agent_a",
    permissionSet: ["project.read", "ticket.create", "ticket.assign"],
  });
  repository.createAssignment({
    id: "assignment_b",
    projectId: "prj_1",
    agentId: "agent_b",
    permissionSet: ["project.read", "ticket.read", "ticket.update"],
  });
  return database;
}

function collect<T>(stream: AsyncIterable<T>) {
  return (async () => {
    const events: T[] = [];
    for await (const event of stream) events.push(event);
    return events;
  })();
}

describe("release smoke scenarios", () => {
  it("parcourt ticket → exécution fake → livrable → revue humaine", async () => {
    const database = createFixture();
    const tickets = new TicketService(database, { now: () => CLOCK });
    const ticket = tickets.createTicket({
      id: "ticket_release",
      projectId: "prj_1",
      title: "Release smoke ticket",
      body: "Verify the release path with a controlled provider.",
      author: { type: "agent", id: "agent_a" },
      acceptanceCriteria: ["The controlled execution is reviewable"],
      idempotencyKey: "ticket_release_request",
      now: CLOCK,
    });
    expect(
      tickets.assignTicket({
        ticketId: ticket.id,
        ownerId: "agent_b",
        actor: { type: "agent", id: "agent_a" },
        now: CLOCK,
      }),
    ).toMatchObject({ ownerId: "agent_b", state: "todo" });
    expect(
      tickets.transitionTicket({
        ticketId: ticket.id,
        nextState: "in_progress",
        actor: { type: "agent", id: "agent_b" },
        idempotencyKey: "ticket_release_start",
        now: CLOCK,
      }),
    ).toMatchObject({ state: "in_progress" });

    const executions = new ExecutionService(database, { now: () => CLOCK });
    const execution = executions.enqueue({
      id: "execution_release",
      projectId: "prj_1",
      assignmentId: "assignment_b",
      triggerId: "trigger_release",
      instruction: "Implement the ticket and prepare a reviewable result",
      contextRefs: ["project:prj_1", "ticket:ticket_release"],
      requestedWorkspaceId: "workspace_release",
      idempotencyKey: "execution_release_request",
    });
    const running = executions.reserveNext("worker_release", CLOCK);
    expect(running).toMatchObject({ id: execution.id, state: "running" });

    const adapter = new FakeAgentAdapter({
      provider: "fake-b",
      steps: [
        { kind: "message", content: "implementation ready" },
        { kind: "event", type: "tool_activity", data: { tool: "tests" } },
      ],
    });
    const providerEvents = await collect(
      adapter.execute({
        executionId: execution.id,
        projectId: "prj_1",
        assignmentId: "assignment_b",
        triggerId: "trigger_release",
        instruction: execution.instruction,
        contextRefs: execution.contextRefs,
      }),
    );
    expect(providerEvents.map((event) => event.type)).toEqual([
      "output",
      "tool_activity",
      "result",
    ]);

    const parent = mkdtempSync(join("/tmp", "coderoom-release-"));
    temporaryDirectories.push(parent);
    const repositoryPath = createGitRepository(parent);
    new ProjectRepositoryService(database).linkRepository({
      projectId: "prj_1",
      path: repositoryPath,
      idempotencyKey: "repository_release",
      actor: { type: "human", id: "owner_1" },
      correlationId: "repository_release_correlation",
    });
    const workspaces = new WorkspaceService(database, {
      now: () => CLOCK,
      defaultLeaseDurationMs: 60_000,
    });
    workspaces.allocate({
      id: "workspace_release",
      projectId: "prj_1",
      ticketId: ticket.id,
      idempotencyKey: "workspace_release_request",
    });
    const lock = workspaces.acquireLock({
      workspaceId: "workspace_release",
      ownerId: "agent_b",
      executionId: execution.id,
      idempotencyKey: "lock_release_request",
      leaseDurationMs: 60_000,
      now: CLOCK,
    });
    const deliverable = new DeliverableService(database, {
      now: () => CLOCK,
      gitInspector: {
        inspect: ({ workspace, requestedRef }) => ({
          repositoryPath: workspace.repositoryPath,
          gitRef: requestedRef ?? "refs/heads/main",
          commit: "a".repeat(40),
          branch: "main",
          workingTreeStatus: "dirty",
          diff: "diff --git a/app b/app\n+implementation\n",
          refVerified: true,
        }),
      },
    }).submit({
      id: "deliverable_release",
      ticketId: ticket.id,
      executionId: execution.id,
      workspaceId: "workspace_release",
      lockToken: lock.lockToken,
      requestedRef: "refs/heads/main",
      testEvidence: [
        {
          id: "evidence_release",
          command: "npm test -- --run release smoke",
          source: "runner",
          outcome: "passed",
          exitCode: 0,
          stdout: "release smoke passed",
          stderr: "",
          startedAt: CLOCK,
          finishedAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      actor: { type: "agent", id: "agent_b" },
      idempotencyKey: "deliverable_release_request",
      now: CLOCK,
    });
    expect(deliverable.testEvidence[0]).toMatchObject({ outcome: "passed" });
    workspaces.releaseLock({
      workspaceId: "workspace_release",
      ownerId: "agent_b",
      lockToken: lock.lockToken,
      now: CLOCK,
    });

    const reviews = new ReviewService(database, { now: () => CLOCK });
    expect(
      reviews.submitForReview({
        ticketId: ticket.id,
        deliverableId: deliverable.id,
        executionId: execution.id,
        actor: { type: "agent", id: "agent_b" },
        idempotencyKey: "submission_release_request",
        now: CLOCK,
      }),
    ).toMatchObject({ ticket: { state: "in_review" } });
    expect(
      reviews.recordReview({
        ticketId: ticket.id,
        deliverableId: deliverable.id,
        actor: { type: "human", id: "owner_1" },
        decision: "accepted",
        idempotencyKey: "review_release_request",
        now: CLOCK,
      }),
    ).toMatchObject({ ticket: { state: "done" }, review: { decision: "accepted" } });
    expect(
      executions.transition(execution.id, "succeeded", {
        workerId: "worker_release",
        now: CLOCK,
      }),
    ).toMatchObject({
      state: "succeeded",
    });
  });

  it("réconcilie une exécution en cours en unknown après fermeture et reload", () => {
    const parent = mkdtempSync(join("/tmp", "coderoom-restart-"));
    temporaryDirectories.push(parent);
    const filename = join(parent, "coderoom.sqlite");

    let database = openDatabase(filename);
    const repository = createCoreRepository(database);
    repository.createOrganization({ id: "org_restart", name: "Local" });
    repository.createProject({
      id: "prj_restart",
      organizationId: "org_restart",
      name: "Restart",
    });
    repository.createAgent({
      id: "agent_restart",
      provider: "fake",
      displayName: "Fake",
      role: "developer",
    });
    repository.createAssignment({
      id: "assignment_restart",
      projectId: "prj_restart",
      agentId: "agent_restart",
      permissionSet: ["project.read"],
    });
    const firstService = new ExecutionService(database, { now: () => CLOCK });
    firstService.enqueue({
      id: "execution_restart",
      projectId: "prj_restart",
      assignmentId: "assignment_restart",
      triggerId: "trigger_restart",
      instruction: "Simulate a process crash",
      contextRefs: ["project:prj_restart"],
      idempotencyKey: "execution_restart_request",
    });
    firstService.reserveNext("worker_restart", CLOCK);
    database.close();

    database = openDatabase(filename);
    databases.push(database);
    const reconciled = new ExecutionService(database, {
      now: () => CLOCK,
    }).reconcileAfterRestart("2026-01-01T00:00:02.000Z");
    expect(reconciled).toMatchObject([{ id: "execution_restart", state: "unknown" }]);
    expect(new ExecutionService(database).listTransitions("execution_restart")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromState: "running",
          toState: "unknown",
          reason: "process_restart_reconciliation",
        }),
      ]),
    );
  });

  it("annule une exécution fake en pause sans produire de sortie après l'arrêt", async () => {
    const database = createFixture();
    const executions = new ExecutionService(database, { now: () => CLOCK });
    const execution = executions.enqueue({
      id: "execution_cancel",
      projectId: "prj_1",
      assignmentId: "assignment_b",
      triggerId: "trigger_cancel",
      instruction: "Wait for cancellation",
      contextRefs: ["project:prj_1"],
      idempotencyKey: "execution_cancel_request",
    });
    executions.reserveNext("worker_cancel", CLOCK);
    const adapter = new FakeAgentAdapter({
      steps: [
        { kind: "pause", durationMs: 1_000 },
        { kind: "message", content: "must not be emitted" },
      ],
    });
    const iterator = adapter
      .execute({
        executionId: execution.id,
        projectId: "prj_1",
        assignmentId: "assignment_b",
        triggerId: "trigger_cancel",
        instruction: execution.instruction,
        contextRefs: execution.contextRefs,
      })
      [Symbol.asyncIterator]();
    const firstEvent = iterator.next();
    await expect(adapter.cancel(execution.id)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(
      executions.cancel(execution.id, { workerId: "worker_cancel", now: CLOCK }),
    ).toMatchObject({ status: "cancelled", execution: { state: "cancelled" } });
    await expect(firstEvent).resolves.toMatchObject({
      value: { type: "error", data: { code: "CANCELLED" } },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "result", data: { status: "cancelled" } },
    });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });
});
