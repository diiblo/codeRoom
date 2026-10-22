import { afterEach, describe, expect, it } from "vitest";
import { AgentService } from "../agents/service.js";
import { openDatabase } from "../db/database.js";
import { createCoreRepository } from "../db/repository.js";
import { ExecutionService } from "../executions/service.js";
import { ProjectService } from "../projects/service.js";
import { TicketService } from "../tickets/service.js";
import {
  StructuredTicketActionService,
  TicketActionError,
  type TicketActionType,
} from "./ticket.js";

const databases: Array<ReturnType<typeof openDatabase>> = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function createFixture() {
  const database = openDatabase(":memory:");
  databases.push(database);
  const repository = createCoreRepository(database);
  repository.createOrganization({ id: "org_1", name: "Local" });
  const agents = new AgentService(database);
  agents.createAgent({
    id: "agt_1",
    provider: "codex",
    displayName: "Builder",
    role: "developer",
  });
  agents.createAgent({
    id: "agt_2",
    provider: "claude",
    displayName: "Reviewer",
    role: "reviewer",
  });
  agents.createAgent({
    id: "agt_3",
    provider: "antigravity",
    displayName: "Other project",
    role: "developer",
  });
  const projects = new ProjectService(database);
  projects.createProject({
    id: "prj_1",
    organizationId: "org_1",
    name: "One",
    mainConversationId: "conv_main_1",
    idempotencyKey: "project_req_1",
  });
  projects.createProject({
    id: "prj_2",
    organizationId: "org_1",
    name: "Two",
    mainConversationId: "conv_main_2",
    idempotencyKey: "project_req_2",
  });
  repository.createAssignment({
    id: "asgn_1",
    projectId: "prj_1",
    agentId: "agt_1",
    permissionSet: ["ticket.read", "ticket.create", "ticket.assign", "ticket.update"],
  });
  repository.createAssignment({
    id: "asgn_2",
    projectId: "prj_1",
    agentId: "agt_2",
    permissionSet: ["ticket.read"],
  });
  repository.createAssignment({
    id: "asgn_3",
    projectId: "prj_2",
    agentId: "agt_3",
    permissionSet: ["ticket.read"],
  });
  return database;
}

function runningExecution(database: ReturnType<typeof openDatabase>) {
  const executions = new ExecutionService(database, {
    now: () => "2026-01-01T00:00:00.000Z",
  });
  executions.enqueue({
    id: "exec_1",
    projectId: "prj_1",
    assignmentId: "asgn_1",
    triggerId: "trigger_1",
    instruction: "Manage the ticket",
    contextRefs: ["project:prj_1"],
    idempotencyKey: "execution_req_1",
  });
  executions.reserveNext("worker_1", "2026-01-01T00:00:00.000Z");
}

function action(
  type: TicketActionType,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  projectId = "prj_1",
) {
  return {
    action: {
      type,
      actionId: "client-controlled-id",
      executionId: "exec_1",
      projectId,
      idempotencyKey,
      payload,
    },
    identity: { type: "agent" as const, id: "agt_1", assignmentId: "asgn_1" },
  };
}

describe("structured ticket actions", () => {
  it("crée un ticket depuis une exécution agent et rejoue idempotemment", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredTicketActionService(database);
    const request = action("ticket.create", "action_create_1", {
      title: "Add search",
      body: "Expose a project search endpoint",
      acceptanceCriteria: ["Search is scoped to the project"],
      priority: "high",
    });

    const first = service.handle(request);
    const repeated = service.handle(request);

    expect(first).toMatchObject({
      actionType: "ticket.create",
      executionId: "exec_1",
      replayed: false,
      ticket: {
        projectId: "prj_1",
        title: "Add search",
        state: "todo",
        priority: "high",
        authorId: "agt_1",
      },
    });
    expect(first.actionId).not.toBe("client-controlled-id");
    expect(repeated).toEqual({ ...first, replayed: true });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM tickets").get(),
    ).toMatchObject({
      count: 1,
    });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("action.ticket.accepted"),
    ).toMatchObject({ count: 1 });

    expect(() =>
      service.handle(
        action("ticket.create", "action_create_1", {
          title: "Contradictory",
          body: "Another request",
          acceptanceCriteria: ["Must conflict"],
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<TicketActionError>>({ code: "CONFLICT" }),
    );
  });

  it("refuse l'attribution à un agent d'un autre projet", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredTicketActionService(database);
    const created = service.handle(
      action("ticket.create", "action_create_2", {
        title: "Scoped ticket",
        body: "Keep ownership inside the project",
        acceptanceCriteria: ["Foreign project assignment is rejected"],
      }),
    );

    expect(() =>
      service.handle(
        action("ticket.assign", "action_assign_cross_project", {
          ticketId: created.ticket.id,
          ownerId: "agt_3",
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<TicketActionError>>({ code: "FORBIDDEN" }),
    );
    expect(
      new TicketService(database).requireTicket(created.ticket.id).ownerId,
    ).toBeNull();
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type = ?")
        .get("action.ticket.rejected"),
    ).toMatchObject({ count: 1 });
  });

  it("refuse la clôture directe et applique assignation puis transition", () => {
    const database = createFixture();
    runningExecution(database);
    const service = new StructuredTicketActionService(database);
    const created = service.handle(
      action("ticket.create", "action_create_3", {
        title: "Reviewable ticket",
        body: "Move through the controlled lifecycle",
        acceptanceCriteria: ["Direct closure is impossible"],
      }),
    );

    const assigned = service.handle(
      action("ticket.assign", "action_assign_1", {
        ticketId: created.ticket.id,
        ownerId: "agt_2",
      }),
    );
    expect(assigned.ticket.ownerId).toBe("agt_2");

    expect(() =>
      service.handle(
        action("ticket.update", "action_update_done", {
          ticketId: created.ticket.id,
          nextState: "done",
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<TicketActionError>>({ code: "CONFLICT" }),
    );

    const started = service.handle(
      action("ticket.update", "action_update_started", {
        ticketId: created.ticket.id,
        nextState: "in_progress",
      }),
    );
    expect(started.ticket.state).toBe("in_progress");
  });
});
