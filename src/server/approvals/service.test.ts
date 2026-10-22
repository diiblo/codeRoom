import { afterEach, describe, expect, it } from "vitest";
import { AssignmentService } from "../assignments/service.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { EventService } from "../events/service.js";
import { ExecutionService } from "../executions/service.js";
import {
  ApprovalService,
  ApprovalServiceError,
  type RequestApprovalInput,
} from "./service.js";

const databases: Array<ReturnType<typeof openDatabase>> = [];
const CLOCK = "2026-01-01T00:00:00.000Z";

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
    permissionSet: ["project.read", "git.write_scoped"],
  });
  repository.createAssignment({
    id: "asgn_2",
    projectId: "prj_2",
    agentId: "agt_2",
    permissionSet: ["project.read", "git.write_scoped"],
  });
  const executions = new ExecutionService(database, { now: () => CLOCK });
  executions.enqueue({
    id: "exec_1",
    projectId: "prj_1",
    assignmentId: "asgn_1",
    triggerId: "trigger_1",
    instruction: "Prepare the change",
    contextRefs: ["project:prj_1"],
    idempotencyKey: "exec_request_1",
  });
  executions.reserveNext("worker_1", CLOCK);
  return { database, executions };
}

function approvalRequest(
  overrides: Partial<RequestApprovalInput> = {},
): RequestApprovalInput {
  return {
    id: "approval_1",
    actionRequestId: "action_request_1",
    executionId: "exec_1",
    actionType: "git.write",
    requiredPermission: "git.write_scoped",
    payload: { path: "src/app.ts", operation: "write" },
    idempotencyKey: "approval_request_1",
    now: CLOCK,
    ...overrides,
  };
}

function createApprovalService(
  database: ReturnType<typeof openDatabase>,
  executions: ExecutionService,
) {
  return new ApprovalService(database, {
    now: () => CLOCK,
    executionService: executions,
    ownerAuthorizer: ({ projectId, identity }) =>
      projectId === "prj_1" && identity.id === "owner_1",
  });
}

describe("ApprovalService", () => {
  it("persiste une demande, déduplique la requête et survit à la recréation du service", () => {
    const { database, executions } = createFixture();
    const service = createApprovalService(database, executions);

    const first = service.requestApproval(approvalRequest());
    expect(first).toMatchObject({
      id: "approval_1",
      status: "pending",
      projectId: "prj_1",
      executionId: "exec_1",
      requiredPermission: "git.write_scoped",
    });
    expect(executions.getExecution("exec_1")).toMatchObject({
      state: "awaiting_approval",
      leaseOwner: "worker_1",
    });
    expect(service.requestApproval(approvalRequest())).toEqual(first);
    expect(() =>
      service.requestApproval(
        approvalRequest({ payload: { path: "src/other.ts", operation: "write" } }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovalServiceError>>({ code: "CONFLICT" }),
    );

    const restarted = createApprovalService(database, executions);
    expect(restarted.listPending("prj_1", CLOCK)).toEqual([first]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM approvals").get(),
    ).toMatchObject({ count: 1 });
  });

  it("refuse le spoofing agent et rend la double décision idempotente", () => {
    const { database, executions } = createFixture();
    const service = createApprovalService(database, executions);
    const approval = service.requestApproval(approvalRequest());

    expect(() =>
      service.decideApproval({
        approvalId: approval.id,
        decision: "approved",
        identity: { type: "agent", id: "agt_1" },
        now: CLOCK,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovalServiceError>>({ code: "FORBIDDEN" }),
    );
    expect(service.getApproval(approval.id)).toMatchObject({ status: "pending" });
    expect(executions.getExecution("exec_1")).toMatchObject({
      state: "awaiting_approval",
    });

    const denied = service.decideApproval({
      approvalId: approval.id,
      decision: "denied",
      identity: { type: "human", id: "owner_1" },
      reason: "Not authorized for this change",
      now: CLOCK,
    });
    expect(denied).toMatchObject({
      status: "denied",
      decidedByType: "human",
      decidedById: "owner_1",
      decisionReason: "Not authorized for this change",
    });
    expect(
      service.decideApproval({
        approvalId: approval.id,
        decision: "denied",
        identity: { type: "human", id: "owner_1" },
        now: CLOCK,
      }),
    ).toEqual(denied);
    expect(() =>
      service.decideApproval({
        approvalId: approval.id,
        decision: "approved",
        identity: { type: "human", id: "owner_1" },
        now: CLOCK,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ApprovalServiceError>>({ code: "CONFLICT" }),
    );
    expect(executions.getExecution("exec_1")).toMatchObject({ state: "cancelled" });
  });

  it("reprend l'exécution uniquement après une décision approuvée et audite le résultat", () => {
    const { database, executions } = createFixture();
    const service = createApprovalService(database, executions);
    const approval = service.requestApproval(approvalRequest());

    const decided = service.decideApproval({
      approvalId: approval.id,
      decision: "approved",
      identity: { type: "human", id: "owner_1" },
      reason: "Reviewed",
      now: "2026-01-01T00:00:01.000Z",
    });
    expect(decided).toMatchObject({
      status: "approved",
      decidedByType: "human",
      decidedById: "owner_1",
    });
    expect(executions.getExecution("exec_1")).toMatchObject({ state: "running" });

    const events = new EventService(database).listEvents({ projectId: "prj_1" }).items;
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["approval.requested", "approval.resolved"]),
    );
    expect(events.find((event) => event.type === "approval.resolved")).toMatchObject({
      actorType: "human",
      actorId: "owner_1",
      payload: { decision: "approved", status: "approved" },
    });
  });

  it("expire une demande sans effet d'exécution et refuse une décision tardive", () => {
    const { database, executions } = createFixture();
    const service = createApprovalService(database, executions);
    const approval = service.requestApproval(
      approvalRequest({ expiresAt: "2026-01-01T00:00:05.000Z" }),
    );

    expect(service.reconcilePending("2026-01-01T00:00:05.000Z")).toMatchObject([
      { id: approval.id, status: "expired", decidedByType: "system" },
    ]);
    expect(executions.getExecution("exec_1")).toMatchObject({ state: "cancelled" });
    expect(
      service.decideApproval({
        approvalId: approval.id,
        decision: "approved",
        identity: { type: "human", id: "owner_1" },
        now: "2026-01-01T00:01:00.000Z",
      }),
    ).toMatchObject({ status: "expired" });
    expect(executions.getExecution("exec_1")).toMatchObject({ state: "cancelled" });
  });

  it("invalide une approbation restée en attente après réconciliation de redémarrage", () => {
    const { database, executions } = createFixture();
    const service = createApprovalService(database, executions);
    const approval = service.requestApproval(approvalRequest());

    expect(executions.reconcileAfterRestart("2026-01-01T00:00:01.000Z")).toMatchObject([
      { id: "exec_1", state: "unknown" },
    ]);
    expect(service.reconcilePending("2026-01-01T00:00:01.000Z")).toMatchObject([
      {
        id: approval.id,
        status: "denied",
        decisionReason: "execution_not_awaiting_approval",
      },
    ]);
    expect(service.getApproval(approval.id)).toMatchObject({ status: "denied" });
  });

  it("invalide une demande si les droits de l'affectation sont révoqués", () => {
    const { database, executions } = createFixture();
    const service = createApprovalService(database, executions);
    const approval = service.requestApproval(approvalRequest());
    new AssignmentService(database).updatePermissions({
      assignmentId: "asgn_1",
      permissionSet: ["project.read"],
    });

    expect(service.reconcilePending(CLOCK)).toMatchObject([
      { id: approval.id, status: "denied", decisionReason: "context_changed" },
    ]);
    expect(executions.getExecution("exec_1")).toMatchObject({ state: "cancelled" });
  });
});
