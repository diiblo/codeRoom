import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  StructuredReviewActionService,
  type ReviewActionType,
} from "../actions/review.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import {
  DeliverableService,
  type GitInspectionProvider,
} from "../deliverables/service.js";
import { ExecutionService } from "../executions/service.js";
import { ProjectRepositoryService } from "../projects/repository-service.js";
import { ProjectService } from "../projects/service.js";
import { TicketService } from "../tickets/service.js";
import { WorkspaceService } from "../workspaces/service.js";
import { ReviewService, ReviewServiceError } from "./service.js";

const CLOCK = "2026-01-01T00:00:00.000Z";
const temporaryDirectories: string[] = [];
const databases: Array<ReturnType<typeof openDatabase>> = [];

function createGitRepository(parent: string) {
  const repositoryPath = join(parent, "repo");
  const gitPath = join(repositoryPath, ".git");
  mkdirSync(join(gitPath, "objects"), { recursive: true });
  mkdirSync(join(gitPath, "refs"), { recursive: true });
  writeFileSync(join(gitPath, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(gitPath, "config"), "[core]\n");
  return repositoryPath;
}

function action(
  type: ReviewActionType,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  executionId: string,
  identity: { id: string; assignmentId: string },
) {
  return {
    action: {
      type,
      executionId,
      projectId: "prj_1",
      idempotencyKey,
      payload,
    },
    identity: { type: "agent" as const, ...identity },
    correlationId: `${idempotencyKey}:correlation`,
  };
}

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  repository.createAgent({
    id: "agt_owner",
    provider: "codex",
    displayName: "Builder",
    role: "developer",
  });
  repository.createAgent({
    id: "agt_reviewer",
    provider: "claude",
    displayName: "Reviewer",
    role: "reviewer",
  });
  repository.createAgent({
    id: "agt_outsider",
    provider: "antigravity",
    displayName: "Outsider",
    role: "developer",
  });
  new ProjectService(database).createProject({
    id: "prj_1",
    organizationId: "org_1",
    name: "One",
    idempotencyKey: "project_1",
  });
  repository.createAssignment({
    id: "asgn_owner",
    projectId: "prj_1",
    agentId: "agt_owner",
    permissionSet: ["ticket.submit_review", "review.submit"],
  });
  repository.createAssignment({
    id: "asgn_reviewer",
    projectId: "prj_1",
    agentId: "agt_reviewer",
    permissionSet: ["review.submit"],
  });
  repository.createAssignment({
    id: "asgn_outsider",
    projectId: "prj_1",
    agentId: "agt_outsider",
    permissionSet: ["ticket.read"],
  });

  const parent = mkdtempSync(join(tmpdir(), "coderoom-reviews-"));
  temporaryDirectories.push(parent);
  const repositoryPath = createGitRepository(parent);
  new ProjectRepositoryService(database).linkRepository({
    projectId: "prj_1",
    path: repositoryPath,
    idempotencyKey: "repository_1",
    actor: { type: "human", id: "owner_1" },
    correlationId: "repository_1",
  });

  const tickets = new TicketService(database, { now: () => CLOCK });
  tickets.createTicket({
    id: "ticket_1",
    projectId: "prj_1",
    title: "Review the change",
    body: "The change must be reviewed before closure.",
    author: { type: "human", id: "owner_1" },
    acceptanceCriteria: ["A distinct reviewer validates the result"],
    idempotencyKey: "ticket_1",
    now: CLOCK,
  });
  tickets.assignTicket({
    ticketId: "ticket_1",
    ownerId: "agt_owner",
    actor: { type: "human", id: "owner_1" },
    now: CLOCK,
  });
  tickets.transitionTicket({
    ticketId: "ticket_1",
    nextState: "in_progress",
    actor: { type: "agent", id: "agt_owner" },
    idempotencyKey: "ticket_1_progress",
    now: CLOCK,
  });

  const executions = new ExecutionService(database, { now: () => CLOCK });
  executions.enqueue({
    id: "exec_owner",
    projectId: "prj_1",
    assignmentId: "asgn_owner",
    triggerId: "trigger_owner",
    instruction: "Implement the ticket",
    contextRefs: ["ticket:ticket_1"],
    requestedWorkspaceId: "workspace_1",
    idempotencyKey: "exec_owner",
  });
  executions.enqueue({
    id: "exec_reviewer",
    projectId: "prj_1",
    assignmentId: "asgn_reviewer",
    triggerId: "trigger_reviewer",
    instruction: "Review the ticket",
    contextRefs: ["ticket:ticket_1"],
    idempotencyKey: "exec_reviewer",
  });
  executions.enqueue({
    id: "exec_outsider",
    projectId: "prj_1",
    assignmentId: "asgn_outsider",
    triggerId: "trigger_outsider",
    instruction: "Try to review the ticket",
    contextRefs: ["ticket:ticket_1"],
    idempotencyKey: "exec_outsider",
  });
  executions.reserveNext("worker_owner", CLOCK);
  executions.reserveNext("worker_reviewer", "2026-01-01T00:00:01.000Z");
  executions.reserveNext("worker_outsider", "2026-01-01T00:00:02.000Z");

  const workspaces = new WorkspaceService(database, {
    now: () => CLOCK,
    defaultLeaseDurationMs: 60_000,
  });
  workspaces.allocate({
    id: "workspace_1",
    projectId: "prj_1",
    idempotencyKey: "workspace_1",
  });
  const lockToken = workspaces.acquireLock({
    workspaceId: "workspace_1",
    ownerId: "exec_owner",
    executionId: "exec_owner",
    idempotencyKey: "lock_1",
    leaseDurationMs: 60_000,
    now: CLOCK,
  }).lockToken;

  const inspector: GitInspectionProvider = {
    inspect({ workspace }) {
      return {
        repositoryPath: workspace.repositoryPath,
        gitRef: "refs/heads/main",
        commit: "b".repeat(40),
        branch: "main",
        workingTreeStatus: "clean",
        diff: "diff --git a/file b/file\n+change\n",
        refVerified: true,
      };
    },
  };
  const deliverables = new DeliverableService(database, {
    gitInspector: inspector,
    now: () => CLOCK,
  });
  const deliverable = deliverables.submit({
    id: "deliverable_1",
    ticketId: "ticket_1",
    executionId: "exec_owner",
    workspaceId: "workspace_1",
    lockToken,
    actor: { type: "agent", id: "agt_owner" },
    idempotencyKey: "deliverable_1",
    testEvidence: [
      {
        id: "evidence_1",
        command: "npm test",
        source: "runner",
        outcome: "passed",
        exitCode: 0,
        startedAt: CLOCK,
        finishedAt: "2026-01-01T00:00:01.000Z",
      },
    ],
    now: CLOCK,
  });

  return {
    database,
    deliverable,
    reviews: new ReviewService(database, { now: () => CLOCK }),
    actions: new StructuredReviewActionService(database),
  };
}

describe("ReviewService et StructuredReviewActionService", () => {
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("soumet un livrable puis accepte atomiquement avec un relecteur distinct", () => {
    const fixture = createFixture();
    const submission = fixture.actions.handle(
      action(
        "ticket.submit_review",
        "submit_review_1",
        { ticketId: "ticket_1", deliverableId: fixture.deliverable.id },
        "exec_owner",
        { id: "agt_owner", assignmentId: "asgn_owner" },
      ),
    );
    expect(submission).toMatchObject({
      actionType: "ticket.submit_review",
      replayed: false,
      ticket: { id: "ticket_1", state: "in_review" },
      submission: { deliverableId: "deliverable_1", submitter: { id: "agt_owner" } },
    });
    expect(
      fixture.actions.handle(
        action(
          "ticket.submit_review",
          "submit_review_1",
          { ticketId: "ticket_1", deliverableId: fixture.deliverable.id },
          "exec_owner",
          { id: "agt_owner", assignmentId: "asgn_owner" },
        ),
      ),
    ).toEqual({ ...submission, replayed: true });

    const review = fixture.actions.handle(
      action(
        "review.submit",
        "review_accept_1",
        {
          ticketId: "ticket_1",
          deliverableId: fixture.deliverable.id,
          decision: "accepted",
        },
        "exec_reviewer",
        { id: "agt_reviewer", assignmentId: "asgn_reviewer" },
      ),
    );
    expect(review).toMatchObject({
      actionType: "review.submit",
      replayed: false,
      ticket: { state: "done" },
      review: {
        decision: "accepted",
        reviewer: { id: "agt_reviewer" },
      },
    });
    expect(fixture.reviews.listReviewsByTicket("ticket_1")).toHaveLength(1);
    expect(
      fixture.database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("review.recorded"),
    ).toMatchObject({ count: 1 });
  });

  it("réouvre le ticket en cas de rejet et conserve l'historique", () => {
    const fixture = createFixture();
    fixture.actions.handle(
      action(
        "ticket.submit_review",
        "submit_review_reject",
        { ticketId: "ticket_1", deliverableId: fixture.deliverable.id },
        "exec_owner",
        { id: "agt_owner", assignmentId: "asgn_owner" },
      ),
    );
    const rejected = fixture.actions.handle(
      action(
        "review.submit",
        "review_reject_1",
        {
          ticketId: "ticket_1",
          deliverableId: fixture.deliverable.id,
          decision: "rejected",
          reason: "Add the missing regression test",
        },
        "exec_reviewer",
        { id: "agt_reviewer", assignmentId: "asgn_reviewer" },
      ),
    );

    expect(rejected).toMatchObject({
      ticket: { state: "in_progress" },
      review: { decision: "rejected", reason: "Add the missing regression test" },
    });
    expect(fixture.reviews.listReviewsByTicket("ticket_1")).toMatchObject([
      { decision: "rejected" },
    ]);
  });

  it("refuse l'auto-validation, le reviewer sans permission et la soumission sans preuve", () => {
    const fixture = createFixture();
    fixture.actions.handle(
      action(
        "ticket.submit_review",
        "submit_review_self",
        { ticketId: "ticket_1", deliverableId: fixture.deliverable.id },
        "exec_owner",
        { id: "agt_owner", assignmentId: "asgn_owner" },
      ),
    );
    expect(() =>
      fixture.actions.handle(
        action(
          "review.submit",
          "review_self",
          {
            ticketId: "ticket_1",
            deliverableId: fixture.deliverable.id,
            decision: "accepted",
          },
          "exec_owner",
          { id: "agt_owner", assignmentId: "asgn_owner" },
        ),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ReviewServiceError>>({ code: "FORBIDDEN" }),
    );

    expect(() =>
      fixture.actions.handle(
        action(
          "review.submit",
          "review_outsider",
          {
            ticketId: "ticket_1",
            deliverableId: fixture.deliverable.id,
            decision: "accepted",
          },
          "exec_outsider",
          { id: "agt_outsider", assignmentId: "asgn_outsider" },
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));

    const emptyDeliverableId = "deliverable_empty";
    fixture.database
      .prepare(
        `
          INSERT INTO deliverables
            (id, ticket_id, project_id, workspace_id, repository_path,
             git_ref, git_commit, working_tree_status, state,
             submitted_by_type, submitted_by_id, created_at)
          VALUES (?, 'ticket_1', 'prj_1', 'workspace_1', ?,
                  'refs/heads/main', ?, 'clean', 'submitted', 'agent', 'agt_owner', ?)
        `,
      )
      .run(
        emptyDeliverableId,
        fixture.deliverable.repositoryPath,
        "c".repeat(40),
        CLOCK,
      );
    new TicketService(fixture.database, { now: () => CLOCK }).transitionTicket({
      ticketId: "ticket_1",
      nextState: "in_progress",
      actor: { type: "agent", id: "agt_owner" },
      idempotencyKey: "restore_after_self_review",
      reason: "Corrections required",
      now: CLOCK,
    });
    expect(() =>
      fixture.actions.handle(
        action(
          "ticket.submit_review",
          "submit_review_empty",
          { ticketId: "ticket_1", deliverableId: emptyDeliverableId },
          "exec_owner",
          { id: "agt_owner", assignmentId: "asgn_owner" },
        ),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "CONFLICT",
        message: "A deliverable without test evidence cannot be reviewed",
      }),
    );
  });

  it("autorise un verdict humain distinct et exige une raison au rejet", () => {
    const fixture = createFixture();
    fixture.reviews.submitForReview({
      ticketId: "ticket_1",
      deliverableId: fixture.deliverable.id,
      executionId: "exec_owner",
      actor: { type: "agent", id: "agt_owner" },
      idempotencyKey: "human_review_submission",
      now: CLOCK,
    });
    expect(() =>
      fixture.reviews.recordReview({
        ticketId: "ticket_1",
        deliverableId: fixture.deliverable.id,
        actor: { type: "human", id: "owner_1" },
        decision: "rejected",
        idempotencyKey: "human_review_missing_reason",
        now: CLOCK,
      }),
    ).toThrowError(
      new ReviewServiceError("VALIDATION_ERROR", "A rejected review requires a reason"),
    );
    const accepted = fixture.reviews.recordReview({
      ticketId: "ticket_1",
      deliverableId: fixture.deliverable.id,
      actor: { type: "human", id: "owner_1" },
      decision: "accepted",
      idempotencyKey: "human_review_accept",
      now: CLOCK,
    });
    expect(accepted.ticket.state).toBe("done");
  });
});
